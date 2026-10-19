import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_WORKSPACE, LINKS, WORKSPACE_PATTERN } from "../constants.js";
import { EMAIL_PATTERN } from "../backend/functions.js";
import type { CommonOptions, Deps } from "../core/context.js";
import { ClayverError } from "../core/errors.js";
import type { Logger } from "../core/logger.js";
import { readManifest } from "../core/manifest.js";

export type AgentRole = "admin" | "agent";

export interface AdminUser {
  uid: string;
  email?: string;
  displayName?: string;
  customClaims?: Record<string, unknown>;
}

/** The slice of firebase-admin Clayver needs; tests provide an in-memory fake. */
export interface AdminBackend {
  getUserByEmail(email: string): Promise<AdminUser | undefined>;
  /** undefined when no user has this uid. */
  getUser(uid: string): Promise<AdminUser | undefined>;
  createUser(email: string): Promise<AdminUser>;
  setCustomUserClaims(uid: string, claims: Record<string, unknown> | null): Promise<void>;
  revokeRefreshTokens(uid: string): Promise<void>;
  passwordResetLink(email: string): Promise<string>;
  dbGet(path: string): Promise<unknown>;
  dbSet(path: string, value: unknown): Promise<void>;
  /** Releases connections (the database keeps a socket open otherwise). */
  close?(): Promise<void>;
}

export interface AgentRecord {
  role: AgentRole;
  active: boolean;
  email: string | null;
  displayName: string;
  createdAt: number;
  updatedAt: number;
  grantedBy: string;
}

export const GRANTED_BY_CLI = "clayver-cli";

export function agentPath(workspace: string, uid: string) {
  return `clayver/projects/${workspace}/agents/${uid}`;
}

function registryPath(workspace: string) {
  return `clayver/registry/${workspace}`;
}

function rolesOf(claims: Record<string, unknown> | undefined): Record<string, string> {
  const r = claims?.clayver_roles;
  return r && typeof r === "object" && !Array.isArray(r) ? { ...(r as Record<string, string>) } : {};
}

/** `clayver_roles` with `workspace` set to `role` (or removed for `null`); other claims untouched. */
export function nextClaims(claims: Record<string, unknown> | undefined, workspace: string, role: AgentRole | null): Record<string, unknown> | null {
  const out: Record<string, unknown> = { ...(claims ?? {}) };
  const roles = rolesOf(claims);
  if (role) roles[workspace] = role;
  else delete roles[workspace];
  if (Object.keys(roles).length) out.clayver_roles = roles;
  else delete out.clayver_roles;
  return Object.keys(out).length ? out : null;
}

async function otherActiveAdmins(backend: AdminBackend, workspace: string, uid: string): Promise<number> {
  const agents = ((await backend.dbGet(`clayver/projects/${workspace}/agents`)) ?? {}) as Record<string, Partial<AgentRecord>>;
  return Object.entries(agents).filter(([id, a]) => id !== uid && a?.active === true && a.role === "admin").length;
}

/** Exactly one of `email` and `uid` names the Firebase Auth account. */
export interface UserRef {
  email?: string;
  uid?: string;
}

export interface GrantInput extends UserRef {
  workspace: string;
  role: AgentRole;
  displayName?: string;
  create?: boolean;
  force?: boolean;
  dryRun?: boolean;
  now?: number;
}

async function findUser(backend: AdminBackend, ref: UserRef): Promise<{ user: AdminUser | undefined; label: string; email?: string }> {
  if (ref.uid !== undefined) {
    const uid = ref.uid.trim();
    return { user: await backend.getUser(uid), label: uid };
  }
  const email = (ref.email ?? "").trim().toLowerCase();
  return { user: await backend.getUserByEmail(email), label: email, email };
}

export async function grantRole(backend: AdminBackend, input: GrantInput, logger: Logger): Promise<{ uid: string; record: AgentRecord; inviteLink?: string }> {
  const found = await findUser(backend, input);
  let user = found.user;
  const label = found.label;
  let inviteLink: string | undefined;
  if (!user && found.email === undefined) throw new ClayverError(`No Firebase Auth user with uid ${label}.`);
  if (!user) {
    const email = found.email as string;
    if (!input.create) {
      throw new ClayverError(
        `No Firebase Auth user with email ${email}.`,
        "Ask them to sign in to the dashboard once, or pass --create to create the account and get a password setup link.",
      );
    }
    if (input.dryRun) {
      logger.dryRun(`would create the Firebase Auth user ${email} and print a password setup link`);
      user = { uid: "<new uid>", email };
    } else {
      user = await backend.createUser(email);
      inviteLink = await backend.passwordResetLink(email);
    }
  }
  const path = agentPath(input.workspace, user.uid);
  const existing = (await backend.dbGet(path).catch(() => undefined)) as Partial<AgentRecord> | undefined | null;
  if (existing?.role === "admin" && existing.active && input.role !== "admin" && !input.force) {
    if ((await otherActiveAdmins(backend, input.workspace, user.uid)) === 0) {
      throw new ClayverError(`${label} is the only active admin of workspace "${input.workspace}".`, "Grant admin to someone else first, or pass --force.");
    }
  }
  const now = input.now ?? Date.now();
  const email = user.email?.toLowerCase() ?? found.email ?? null;
  const record: AgentRecord = {
    role: input.role,
    active: true,
    email,
    displayName: input.displayName?.trim() || existing?.displayName || user.displayName || email?.split("@")[0] || user.uid,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    grantedBy: GRANTED_BY_CLI,
  };
  const claims = nextClaims(user.customClaims, input.workspace, input.role);
  if (input.dryRun) {
    logger.dryRun(`would write ${path} = ${JSON.stringify(record)}`);
    logger.dryRun(`would set custom claims of ${user.uid} to ${JSON.stringify(claims)}`);
  } else {
    await backend.dbSet(path, record);
    await backend.dbSet(registryPath(input.workspace), true);
    await backend.setCustomUserClaims(user.uid, claims);
    logger.success(`${label} is now ${input.role === "admin" ? "an admin" : "an agent"} of workspace "${input.workspace}" (uid ${user.uid}).`);
    logger.detail("They get the new role after their ID token refreshes (sign out and in, or within an hour), in the dashboard and in your app.");
    if (inviteLink) logger.info(`Password setup link for ${label} (share it privately): ${inviteLink}`);
  }
  return { uid: user.uid, record, inviteLink };
}

export async function revokeRole(
  backend: AdminBackend,
  input: UserRef & { workspace: string; force?: boolean; dryRun?: boolean; now?: number },
  logger: Logger,
): Promise<{ uid: string } | undefined> {
  const { user, label, email } = await findUser(backend, input);
  if (!user) throw new ClayverError(`No Firebase Auth user with ${email !== undefined ? "email" : "uid"} ${label}.`);
  const path = agentPath(input.workspace, user.uid);
  const existing = (await backend.dbGet(path)) as Partial<AgentRecord> | null | undefined;
  const hasClaim = rolesOf(user.customClaims)[input.workspace] !== undefined;
  if (!existing && !hasClaim) {
    logger.info(`${label} has no role in workspace "${input.workspace}". Nothing to do.`);
    return undefined;
  }
  if (existing?.role === "admin" && existing.active && !input.force) {
    if ((await otherActiveAdmins(backend, input.workspace, user.uid)) === 0) {
      throw new ClayverError(`${label} is the only active admin of workspace "${input.workspace}".`, "Grant admin to someone else first, or pass --force.");
    }
  }
  const now = input.now ?? Date.now();
  const record = { ...(existing ?? {}), active: false, updatedAt: now, grantedBy: GRANTED_BY_CLI };
  const claims = nextClaims(user.customClaims, input.workspace, null);
  if (input.dryRun) {
    logger.dryRun(`would write ${path} = ${JSON.stringify(record)}`);
    logger.dryRun(`would set custom claims of ${user.uid} to ${JSON.stringify(claims)} and revoke their refresh tokens`);
    return { uid: user.uid };
  }
  await backend.dbSet(path, record);
  await backend.setCustomUserClaims(user.uid, claims);
  await backend.revokeRefreshTokens(user.uid);
  logger.success(`Revoked ${label}'s access to workspace "${input.workspace}".`);
  logger.detail("They are signed out on every device, including your app. Database access ends immediately; an already issued token can read attachments for up to one hour.");
  return { uid: user.uid };
}

// ---------------------------------------------------------------- firebase-admin implementation

function adcError(e: unknown, projectId: string): never {
  const msg = (e as Error)?.message ?? String(e);
  if (/default credentials|could not load|invalid_grant|reauth|OAuth2 access token|credential file|GOOGLE_APPLICATION_CREDENTIALS/i.test(msg)) {
    throw new ClayverError(
      "No usable Google Application Default Credentials.",
      `Run \`gcloud auth application-default login\` and \`gcloud auth application-default set-quota-project ${projectId}\` (${LINKS.adc}).`,
    );
  }
  if (/quota project|x-goog-user-project|USER_PROJECT_DENIED|requires a quota project/i.test(msg)) {
    throw new ClayverError(`Google APIs need a quota project for your credentials: ${msg}`, `Run \`gcloud auth application-default set-quota-project ${projectId}\`.`);
  }
  if (/permission|PERMISSION_DENIED|403/i.test(msg)) {
    // With gcloud user credentials, a missing quota project also surfaces as "insufficient permission".
    throw new ClayverError(
      `Permission denied: ${msg}`,
      `Run \`gcloud auth application-default login\` with an account that is Owner or Firebase Admin on ${projectId}, then \`gcloud auth application-default set-quota-project ${projectId}\`.`,
    );
  }
  throw e;
}

/** gcloud's user ADC file, when no service account is configured. */
function gcloudAdcFile(): string | undefined {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return undefined;
  const dir =
    process.env.CLOUDSDK_CONFIG ??
    (process.platform === "win32" ? join(process.env.APPDATA ?? homedir(), "gcloud") : join(homedir(), ".config", "gcloud"));
  const file = join(dir, "application_default_credentials.json");
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as { type?: string }).type === "authorized_user" ? file : undefined;
  } catch {
    return undefined;
  }
}

export async function createFirebaseAdminBackend(projectId: string, databaseURL: string): Promise<AdminBackend> {
  const { initializeApp, applicationDefault, refreshToken, getApps, deleteApp } = await import("firebase-admin/app");
  // User credentials need a quota project; bill this project rather than whatever ADC was set up for.
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ||= projectId;
  // applicationDefault() is cached for the process, so read gcloud's file directly to pick up a fresh login.
  const adcFile = gcloudAdcFile();
  const credential = adcFile ? refreshToken(adcFile) : applicationDefault();
  const { getAuth } = await import("firebase-admin/auth");
  const { getDatabase } = await import("firebase-admin/database");
  for (const a of getApps()) if (a.name === "clayver-cli") await deleteApp(a);
  const app = initializeApp({ credential, projectId, databaseURL }, "clayver-cli");
  const auth = getAuth(app);
  const db = getDatabase(app);
  const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      return adcError(e, projectId);
    }
  };
  return {
    getUserByEmail: (email) =>
      wrap(async () => {
        try {
          const u = await auth.getUserByEmail(email);
          return { uid: u.uid, email: u.email, displayName: u.displayName, customClaims: u.customClaims };
        } catch (e) {
          if ((e as { code?: string }).code === "auth/user-not-found") return undefined;
          throw e;
        }
      }),
    getUser: (uid) =>
      wrap(async () => {
        try {
          const u = await auth.getUser(uid);
          return { uid: u.uid, email: u.email, displayName: u.displayName, customClaims: u.customClaims };
        } catch (e) {
          if ((e as { code?: string }).code === "auth/user-not-found") return undefined;
          throw e;
        }
      }),
    createUser: (email) =>
      wrap(async () => {
        const u = await auth.createUser({ email, emailVerified: false });
        return { uid: u.uid, email: u.email };
      }),
    setCustomUserClaims: (uid, claims) => wrap(() => auth.setCustomUserClaims(uid, claims)),
    revokeRefreshTokens: (uid) => wrap(() => auth.revokeRefreshTokens(uid)),
    passwordResetLink: (email) => wrap(() => auth.generatePasswordResetLink(email)),
    dbGet: (path) => wrap(async () => (await db.ref(path).get()).val()),
    dbSet: (path, value) => wrap(() => db.ref(path).set(value)),
    close: () => deleteApp(app),
  };
}

// ---------------------------------------------------------------- command

export interface AdminOptions extends CommonOptions {
  email?: string;
  /** Firebase Auth uid, for accounts without an email (phone sign-in, for example). */
  uid?: string;
  displayName?: string;
  role?: AgentRole;
  workspace?: string;
  project?: string;
  databaseUrl?: string;
  create?: boolean;
  force?: boolean;
}

function resolveProject(opts: AdminOptions, appDir: string): { projectId: string; databaseURL: string; workspace: string } {
  const m = readManifest(appDir);
  let projectId = opts.project ?? m?.firebaseProjectId ?? undefined;
  if (!projectId) {
    const rc = join(appDir, ".firebaserc");
    if (existsSync(rc)) {
      try {
        projectId = (JSON.parse(readFileSync(rc, "utf8")) as { projects?: { default?: string } }).projects?.default;
      } catch {
        // ignore
      }
    }
  }
  if (!projectId) throw new ClayverError("Which Firebase project?", "Pass --project <firebaseProjectId> or run inside an app set up with `clayver init`.");
  const workspace = opts.workspace ?? m?.workspace ?? DEFAULT_WORKSPACE;
  if (!WORKSPACE_PATTERN.test(workspace)) throw new ClayverError(`Invalid workspace "${workspace}".`);
  const databaseURL =
    opts.databaseUrl ?? (m?.firebaseProjectId === projectId ? m.backend?.databaseURL : undefined) ?? `https://${projectId}-default-rtdb.firebaseio.com`;
  return { projectId, databaseURL, workspace };
}

export async function runAdmin(
  action: "grant" | "revoke",
  opts: AdminOptions,
  deps: Deps & { adminBackend?: AdminBackend },
): Promise<void> {
  const { logger } = deps;
  if ((opts.email === undefined) === (opts.uid === undefined)) {
    throw new ClayverError("Pass exactly one of --email <email> or --uid <firebaseUid>.");
  }
  if (opts.email !== undefined && !EMAIL_PATTERN.test(opts.email)) throw new ClayverError(`"${opts.email}" is not an email address.`);
  if (opts.uid !== undefined && !opts.uid.trim()) throw new ClayverError("--uid must not be empty.");
  if (opts.uid !== undefined && opts.create) throw new ClayverError("--create works only with --email.");
  if (action === "grant" && opts.role !== "admin" && opts.role !== "agent") {
    throw new ClayverError("--role must be admin or agent.");
  }
  const appDir = resolve(deps.cwd, opts.dir ?? ".");
  const { projectId, databaseURL, workspace } = resolveProject(opts, appDir);
  logger.step(`${action === "grant" ? "Granting" : "Revoking"} Clayver role — project ${projectId}, workspace "${workspace}"`);
  logger.detail(`Using Application Default Credentials and ${databaseURL}`);
  const backend = deps.adminBackend ?? (await createFirebaseAdminBackend(projectId, databaseURL));
  try {
    const target: UserRef = opts.uid !== undefined ? { uid: opts.uid } : { email: opts.email };
    if (action === "grant") {
      await grantRole(backend, { workspace, ...target, role: opts.role as AgentRole, displayName: opts.displayName, create: opts.create, force: opts.force, dryRun: opts.dryRun }, logger);
    } else {
      await revokeRole(backend, { workspace, ...target, force: opts.force, dryRun: opts.dryRun }, logger);
    }
  } finally {
    await backend.close?.().catch(() => undefined);
  }
}
