import type { UserRecord } from "firebase-admin/auth";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { auth, db } from "./admin";
import { bootstrapAdmins, CALLABLE } from "./config";
import { paths, registerWorkspace } from "./paths";
import type { AgentRecord, Role } from "./types";
import { optionalString, requireAuth, requireProjectId } from "./validation";

export async function isActiveAdmin(projectId: string, uid: string): Promise<boolean> {
  const snap = await db().ref(paths.agent(projectId, uid)).get();
  const agent = snap.val() as AgentRecord | null;
  return agent?.active === true && agent.role === "admin";
}

async function activeAdminUids(projectId: string): Promise<string[]> {
  const snap = await db().ref(paths.agents(projectId)).get();
  const agents = (snap.val() ?? {}) as Record<string, AgentRecord>;
  return Object.entries(agents)
    .filter(([, a]) => a?.active === true && a.role === "admin")
    .map(([uid]) => uid);
}

export async function setRoleClaim(uid: string, projectId: string, role: Role | null): Promise<void> {
  const user = await auth().getUser(uid);
  const claims = { ...(user.customClaims ?? {}) } as Record<string, unknown>;
  const roles = { ...((claims.clayver_roles as Record<string, Role>) ?? {}) };
  if (role) roles[projectId] = role;
  else delete roles[projectId];
  if (Object.keys(roles).length > 0) claims.clayver_roles = roles;
  else delete claims.clayver_roles;
  await auth().setCustomUserClaims(uid, claims);
}

/** Throws if every active admin matches `isTarget` (removing them would leave no admin). */
async function assertNotLastAdmin(
  projectId: string,
  isTarget: (uid: string) => boolean,
): Promise<void> {
  const agents = ((await db().ref(paths.agents(projectId)).get()).val() ?? {}) as Record<string, AgentRecord>;
  const admins = Object.entries(agents).filter(([, a]) => a?.active === true && a.role === "admin");
  if (admins.length > 0 && admins.every(([uid]) => isTarget(uid))) {
    throw new HttpsError("failed-precondition", "Grant admin to someone else before removing the last admin.");
  }
}

/** Grants a role: the database record (used by RTDB rules) and the claim (used by Storage rules). */
export async function grantRole(
  projectId: string,
  user: UserRecord,
  role: Role,
  grantedBy: string,
  displayName?: string,
): Promise<void> {
  const now = Date.now();
  await registerWorkspace(projectId);
  await db().ref(paths.agent(projectId, user.uid)).transaction((current: AgentRecord | null) => ({
    ...(current ?? {}),
    role,
    active: true,
    email: user.email ?? null,
    displayName: displayName ?? current?.displayName ?? user.displayName ?? user.email ?? null,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    grantedBy,
  }));
  await setRoleClaim(user.uid, projectId, role);
}

/** Revokes every role the user holds in the workspace and signs them out everywhere. */
export async function revokeRole(projectId: string, uid: string, revokedBy: string): Promise<void> {
  await db().ref(paths.agent(projectId, uid)).update({ active: false, updatedAt: Date.now(), grantedBy: revokedBy });
  await setRoleClaim(uid, projectId, null);
  await db().ref(paths.devices(projectId, "agents", uid)).remove();
  // Already-issued ID tokens stay valid for Storage until they expire (max 1h).
  await auth().revokeRefreshTokens(uid);
}

export const clayverBootstrapAdmin = onCall(CALLABLE, async (request) => {
  const caller = requireAuth(request.auth);
  const projectId = requireProjectId(request.data?.projectId);
  const email = (caller.token.email ?? "").toLowerCase();
  const allowed = bootstrapAdmins
    .value()
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!email || caller.token.email_verified !== true) {
    throw new HttpsError("permission-denied", "A verified email address is required to claim the first admin seat.");
  }
  if (!allowed.includes(email)) {
    throw new HttpsError("permission-denied", "This email is not listed in CLAYVER_BOOTSTRAP_ADMINS.");
  }

  // Serialize concurrent bootstrap attempts through a single transaction.
  const lock = await db()
    .ref(`${paths.meta(projectId)}/bootstrap`)
    .transaction((current) => (current ? undefined : { uid: caller.uid, at: Date.now() }));
  if (!lock.committed && (lock.snapshot.val() as { uid?: string } | null)?.uid !== caller.uid) {
    throw new HttpsError("failed-precondition", "This workspace already has an admin. Ask them to grant you a role.");
  }
  const admins = await activeAdminUids(projectId);
  if (admins.includes(caller.uid)) return { role: "admin" };
  if (admins.length > 0) {
    throw new HttpsError("failed-precondition", "This workspace already has an admin. Ask them to grant you a role.");
  }

  await grantRole(projectId, await auth().getUser(caller.uid), "admin", caller.uid);
  return { role: "admin" };
});

export const clayverSetAgentRole = onCall(CALLABLE, async (request) => {
  const caller = requireAuth(request.auth);
  const projectId = requireProjectId(request.data?.projectId);
  if (!(await isActiveAdmin(projectId, caller.uid))) {
    throw new HttpsError("permission-denied", "Only admins can manage agents.");
  }

  const role = request.data?.role;
  if (role !== "admin" && role !== "agent" && role !== "none") {
    throw new HttpsError("invalid-argument", "role must be 'admin', 'agent' or 'none'.");
  }
  const email = optionalString(request.data?.email, "email", 320)?.toLowerCase();
  const uidArg = optionalString(request.data?.uid, "uid", 128);
  const displayName = optionalString(request.data?.displayName, "displayName", 80);
  if ([email, uidArg].filter(Boolean).length !== 1) {
    throw new HttpsError("invalid-argument", "Pass exactly one of email or uid.");
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "email is not a valid address.");
  }

  let user: UserRecord | undefined;
  try {
    user = uidArg ? await auth().getUser(uidArg) : await auth().getUserByEmail(email!);
  } catch (err) {
    if ((err as { code?: string }).code !== "auth/user-not-found") throw err;
  }

  // Never leave a workspace without an active admin.
  if (user && role !== "admin") {
    const target = user.uid;
    await assertNotLastAdmin(projectId, (uid) => uid === target);
  }

  if (role === "none") {
    if (!user) throw new HttpsError("not-found", "No user with that email or uid.");
    await revokeRole(projectId, user.uid, caller.uid);
    return { uid: user.uid, role: "none" };
  }

  let inviteLink: string | undefined;
  if (!user) {
    if (!email) throw new HttpsError("not-found", "No user with that uid.");
    // Invite: create the account and hand the admin a password-setup link to share.
    user = await auth().createUser({ email, displayName, emailVerified: false });
    inviteLink = await auth().generatePasswordResetLink(email);
  }

  await grantRole(projectId, user, role, caller.uid, displayName);
  return { uid: user.uid, role, ...(inviteLink ? { inviteLink } : {}) };
});
