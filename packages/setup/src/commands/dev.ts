import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DASHBOARD_WEB_APP_NAME, DEFAULT_REGION, DEFAULT_WORKSPACE, LINKS } from "../constants.js";
import { EMAIL_PATTERN, functionsEnvFile, parseEnvFile } from "../backend/functions.js";
import { makeCtx, type CommonOptions, type Ctx, type Deps } from "../core/context.js";
import { ClayverError } from "../core/errors.js";
import { parseWebSdkConfig, type WebConfig } from "../dashboard/files.js";
import { firstLine, type FirebaseApp } from "../firebase/cli.js";
import { billingEnabled, enableAuthProviders, gcloudAccessToken, getAuthProviders } from "../firebase/gcp.js";
import { createFirebaseAdminBackend, grantRole } from "./admin.js";

/**
 * `clayver dev setup|dashboard|deploy`: runs the backend, the dashboard and the
 * example apps of the Clayver repository against a Firebase project of your own,
 * for trying out changes to Clayver itself. Everything it writes is git-ignored.
 * (People adding Clayver to their app use `clayver init` instead.)
 */

/** Remembered between runs, in the git-ignored `.clayver/dev.json` at the repository root. */
export interface DevConfig {
  projectId: string;
  workspace: string;
  region: string;
  adminEmail?: string;
}

export interface DevOptions extends CommonOptions {
  project?: string;
}

const DEV_FILE = ".clayver/dev.json";
const DASHBOARD_URL = "http://localhost:5173";
const DASHBOARD_ENV = ".clayver/dashboard.env";
/** Ids the example apps build with unless overridden. */
const EXAMPLE_IDS = { ios: "com.clayver.example", android: "com.clayver.example" };

/** The repository root: the closest parent that has firebase/firebase.json, dashboard/ and examples/. */
export function findRepoRoot(from: string): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "firebase", "firebase.json")) && existsSync(join(dir, "dashboard", "package.json")) && existsSync(join(dir, "examples"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new ClayverError("Not inside the Clayver repository.", "Run the pnpm dev:* scripts from the repository.");
    dir = parent;
  }
}

function readDevConfig(root: string): DevConfig | undefined {
  try {
    return JSON.parse(readFileSync(join(root, DEV_FILE), "utf8")) as DevConfig;
  } catch {
    return undefined;
  }
}

function writeFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function requireDevConfig(root: string): DevConfig {
  const c = readDevConfig(root);
  if (!c) throw new ClayverError("No dev project set up yet.", "Run `pnpm dev:setup` first.");
  return c;
}

// ---------------------------------------------------------------- pure helpers (tested)

/** Reads `<key>` string values from a GoogleService-Info.plist. */
export function plistValue(plist: string, key: string): string | undefined {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1];
}

export interface NativeOptions {
  apiKey: string;
  appId: string;
  messagingSenderId: string;
  projectId: string;
  storageBucket?: string;
  databaseURL?: string;
  iosBundleId?: string;
}

export function iosOptions(plist: string): NativeOptions | undefined {
  const apiKey = plistValue(plist, "API_KEY");
  const appId = plistValue(plist, "GOOGLE_APP_ID");
  const messagingSenderId = plistValue(plist, "GCM_SENDER_ID");
  const projectId = plistValue(plist, "PROJECT_ID");
  if (!apiKey || !appId || !messagingSenderId || !projectId) return undefined;
  return {
    apiKey,
    appId,
    messagingSenderId,
    projectId,
    storageBucket: plistValue(plist, "STORAGE_BUCKET"),
    databaseURL: plistValue(plist, "DATABASE_URL"),
    iosBundleId: plistValue(plist, "BUNDLE_ID"),
  };
}

interface GoogleServicesJson {
  project_info?: { project_number?: string; project_id?: string; storage_bucket?: string; firebase_url?: string };
  client?: { client_info?: { mobilesdk_app_id?: string; android_client_info?: { package_name?: string } }; api_key?: { current_key?: string }[] }[];
}

/** The package name google-services.json registers for `appId` (or its only client). */
export function androidPackage(json: string, appId?: string): string | undefined {
  try {
    const clients = (JSON.parse(json) as GoogleServicesJson).client ?? [];
    const client = clients.find((c) => c.client_info?.mobilesdk_app_id === appId) ?? (clients.length === 1 ? clients[0] : undefined);
    return client?.client_info?.android_client_info?.package_name;
  } catch {
    return undefined;
  }
}

export function androidOptions(json: string, packageName?: string): NativeOptions | undefined {
  let parsed: GoogleServicesJson;
  try {
    parsed = JSON.parse(json) as GoogleServicesJson;
  } catch {
    return undefined;
  }
  const clients = parsed.client ?? [];
  const client = clients.find((c) => c.client_info?.android_client_info?.package_name === packageName) ?? clients[0];
  const info = parsed.project_info;
  const apiKey = client?.api_key?.[0]?.current_key;
  const appId = client?.client_info?.mobilesdk_app_id;
  if (!apiKey || !appId || !info?.project_number || !info.project_id) return undefined;
  return {
    apiKey,
    appId,
    messagingSenderId: info.project_number,
    projectId: info.project_id,
    storageBucket: info.storage_bucket,
    databaseURL: info.firebase_url,
  };
}

function dartOptions(name: string, o: NativeOptions): string {
  const lines = [
    `  static const FirebaseOptions ${name} = FirebaseOptions(`,
    `    apiKey: '${o.apiKey}',`,
    `    appId: '${o.appId}',`,
    `    messagingSenderId: '${o.messagingSenderId}',`,
    `    projectId: '${o.projectId}',`,
  ];
  if (o.databaseURL) lines.push(`    databaseURL: '${o.databaseURL}',`);
  if (o.storageBucket) lines.push(`    storageBucket: '${o.storageBucket}',`);
  if (o.iosBundleId) lines.push(`    iosBundleId: '${o.iosBundleId}',`);
  lines.push("  );");
  return lines.join("\n");
}

/** The Flutter example's lib/firebase_options.dart, in the shape `flutterfire configure` writes. */
export function flutterOptionsFile(android: NativeOptions | undefined, ios: NativeOptions | undefined): string {
  const cases: string[] = [];
  if (android) cases.push("      case TargetPlatform.android:\n        return android;");
  if (ios) cases.push("      case TargetPlatform.iOS:\n        return ios;");
  return [
    "// Generated by `pnpm dev:setup` for your dev Firebase project. Not committed:",
    "// git ignores local changes to this file (git update-index --skip-worktree).",
    "import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;",
    "import 'package:flutter/foundation.dart' show defaultTargetPlatform, TargetPlatform;",
    "",
    "class DefaultFirebaseOptions {",
    "  static FirebaseOptions get currentPlatform {",
    "    switch (defaultTargetPlatform) {",
    ...cases,
    "      default:",
    "        throw UnsupportedError('Run `pnpm dev:setup` for this platform.');",
    "    }",
    "  }",
    "",
    ...[android && dartOptions("android", android), ios && dartOptions("ios", ios)].filter(Boolean).join("\n\n").split("\n"),
    "}",
    "",
  ].join("\n");
}

/** Sets or replaces `key=value` in a .properties file, keeping every other line. */
export function setProperty(text: string | undefined, key: string, value: string): string {
  const lines = (text ?? "").split(/\r?\n/).filter((l, i, all) => !(i === all.length - 1 && l === ""));
  const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  return `${lines.join("\n")}\n`;
}

export function dashboardEnvFile(web: WebConfig, c: DevConfig): string {
  return [
    `# Generated by \`pnpm dev:setup\` for Firebase project "${c.projectId}". Not committed.`,
    `VITE_FIREBASE_API_KEY=${web.apiKey ?? ""}`,
    `VITE_FIREBASE_AUTH_DOMAIN=${web.authDomain ?? `${c.projectId}.firebaseapp.com`}`,
    `VITE_FIREBASE_PROJECT_ID=${web.projectId ?? c.projectId}`,
    `VITE_FIREBASE_DATABASE_URL=${web.databaseURL ?? ""}`,
    `VITE_FIREBASE_STORAGE_BUCKET=${web.storageBucket ?? ""}`,
    `VITE_FIREBASE_MESSAGING_SENDER_ID=${web.messagingSenderId ?? ""}`,
    `VITE_FIREBASE_APP_ID=${web.appId ?? ""}`,
    "VITE_FIREBASE_VAPID_KEY=",
    `VITE_CLAYVER_PROJECT_ID=${c.workspace}`,
    `VITE_CLAYVER_FUNCTIONS_REGION=${c.region}`,
    "VITE_USE_EMULATORS=false",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- steps

async function chooseProject(ctx: Ctx, opts: DevOptions, saved?: DevConfig): Promise<string> {
  if (opts.project) return opts.project;
  const projects = await ctx.fb.listProjects();
  if (!projects.length) throw new ClayverError("Your Firebase account has no projects.", "Create one at https://console.firebase.google.com, then run this again.");
  return ctx.prompter.select({
    message: "Which Firebase project should Clayver use for development?",
    choices: projects.map((p) => ({ name: p.displayName && p.displayName !== p.projectId ? `${p.displayName} (${p.projectId})` : p.projectId, value: p.projectId })),
    default: saved?.projectId && projects.some((p) => p.projectId === saved.projectId) ? saved.projectId : undefined,
    flagHint: "--project",
  });
}

/** Repeats `check` until it passes, telling the user what to do in between. Returns false when they skip. */
async function waitUntil(ctx: Ctx, check: () => Promise<boolean | undefined>, problem: string, link: string): Promise<boolean> {
  for (;;) {
    if ((await check()) !== false) return true;
    ctx.logger.warn(problem);
    ctx.logger.info(`Open ${link}`);
    const again = await ctx.prompter.confirm({ message: "Done? Check again", default: true, yesDefault: false });
    if (!again) return false;
  }
}

async function checkProject(ctx: Ctx, projectId: string): Promise<string | undefined> {
  const { logger, fb } = ctx;
  logger.step("Checking the project");
  let databaseURL: string | undefined;
  await waitUntil(
    ctx,
    async () => {
      const instances = await fb.listDatabaseInstances(projectId);
      if (instances === undefined) return undefined;
      const def = instances.find((i) => i.type === "DEFAULT_DATABASE") ?? instances[0];
      databaseURL = def?.databaseUrl;
      return !!def;
    },
    "There is no Realtime Database yet. Create it (United States is simplest, locked mode is fine).",
    LINKS.database(projectId),
  );
  if (databaseURL) logger.success(`Realtime Database: ${databaseURL}`);

  const token = await gcloudAccessToken(ctx.runner);
  if (!token) {
    logger.info("Install and sign in to gcloud to let Clayver check these for you. Until then, make sure that:");
    logger.info(`- the project is on the Blaze plan: ${LINKS.usage(projectId)}`);
    logger.info(`- Anonymous and Email/Password sign-in are enabled: ${LINKS.authProviders(projectId)}`);
    logger.info(`- Storage is set up: ${LINKS.storage(projectId)}`);
    await ctx.prompter.confirm({ message: "Ready to continue?", default: true, yesDefault: true });
    return databaseURL;
  }
  const deps = { runner: ctx.runner, fetch: ctx.fetch };
  await waitUntil(ctx, () => billingEnabled(deps, projectId, token), "The project is not on the Blaze plan, which Cloud Functions need.", LINKS.usage(projectId));
  logger.success("Blaze plan");
  const providers = await getAuthProviders(deps, projectId, token);
  if (providers && (!providers.anonymous || !providers.emailPassword)) {
    if (await enableAuthProviders(deps, projectId, token)) logger.success("Enabled Anonymous and Email/Password sign-in");
    else await waitUntil(ctx, async () => false, "Enable Anonymous and Email/Password sign-in.", LINKS.authProviders(projectId));
  } else if (providers) logger.success("Anonymous and Email/Password sign-in");
  else logger.info(`Could not read the sign-in providers; make sure Anonymous and Email/Password are enabled: ${LINKS.authProviders(projectId)}`);
  await waitUntil(
    ctx,
    async () => {
      try {
        const res = await ctx.fetch(`https://firebasestorage.googleapis.com/v1beta/projects/${projectId}/buckets`, {
          headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": projectId },
        });
        if (!res.ok) return undefined;
        const body = (await res.json()) as { buckets?: unknown[] };
        return (body.buckets?.length ?? 0) > 0;
      } catch {
        return undefined;
      }
    },
    "Storage is not set up yet (needed for attachments).",
    LINKS.storage(projectId),
  );
  logger.success("Storage");
  return databaseURL;
}

function writeFunctionsEnv(root: string, c: DevConfig) {
  const path = join(root, "firebase", "functions", `.env.${c.projectId}`);
  const existing = existsSync(path) ? parseEnvFile(readFileSync(path, "utf8")) : {};
  writeFile(
    path,
    functionsEnvFile({
      projectId: c.projectId,
      bootstrapAdmins: [],
      region: existing.CLAYVER_FUNCTIONS_REGION || c.region,
      dashboardUrl: existing.CLAYVER_DASHBOARD_URL || DASHBOARD_URL,
      enforceAppCheck: existing.CLAYVER_ENFORCE_APP_CHECK === "true",
      extra: existing,
    }),
  );
}

async function deploy(ctx: Ctx, root: string, c: DevConfig) {
  ctx.logger.step(`Deploying the rules and Cloud Functions to ${c.projectId}`);
  writeFunctionsEnv(root, c);
  const r = await ctx.fb.deploy(["database", "storage", "functions"], c.projectId, join(root, "firebase"), true, true);
  if (r.exitCode !== 0) {
    throw new ClayverError(
      "The deploy failed (see the output above).",
      "On a project's first deploy, Google often needs a few minutes before event-triggered functions can be created (\"Eventarc Service Agent\" errors): wait, then run the command again. Otherwise fix the problem shown above and run it again.",
    );
  }
  ctx.logger.success("Backend deployed");
}

/** Picks the registered app the example should use, registering one when there is none. */
async function nativeApp(ctx: Ctx, platform: "IOS" | "ANDROID", projectId: string, exampleId: string): Promise<FirebaseApp | undefined> {
  const label = platform === "IOS" ? "iOS" : "Android";
  const apps = await ctx.fb.listApps(platform, projectId);
  if (apps === undefined) {
    ctx.logger.warn(`Could not list the ${label} apps of ${projectId}.`);
    return undefined;
  }
  const match = apps.find((a) => a.namespace === exampleId);
  if (match) return match;
  if (apps.length === 1) return apps[0];
  if (apps.length > 1) {
    const appId = await ctx.prompter.select({
      message: `Which ${label} app should the ${label} example use?`,
      choices: apps.map((a) => ({ name: `${a.displayName ?? a.namespace ?? a.appId} (${a.namespace ?? a.appId})`, value: a.appId })),
    });
    return apps.find((a) => a.appId === appId);
  }
  const created = await ctx.fb.createApp(platform, `Clayver example (${label})`, exampleId, projectId);
  if (!created.appId) {
    ctx.logger.warn(`Could not register the ${label} app: ${firstLine(created.result.stderr || created.result.stdout)}`);
    return undefined;
  }
  ctx.logger.success(`Registered the ${label} app ${exampleId}`);
  return { appId: created.appId, platform, namespace: exampleId };
}

async function exampleApps(ctx: Ctx, root: string, c: DevConfig, databaseURL?: string) {
  const { logger, fb } = ctx;
  logger.step("Configuring the example apps");
  let ios: NativeOptions | undefined;
  let android: NativeOptions | undefined;

  const iosApp = await nativeApp(ctx, "IOS", c.projectId, EXAMPLE_IDS.ios);
  const iosConfig = iosApp && (await fb.sdkConfig("IOS", iosApp.appId, c.projectId));
  if (iosConfig) {
    writeFile(join(root, "examples/ios/ClayverExample/GoogleService-Info.plist"), iosConfig.fileContents);
    ios = iosOptions(iosConfig.fileContents);
    logger.success("iOS: examples/ios/ClayverExample/GoogleService-Info.plist");
    if (iosApp.namespace && iosApp.namespace !== EXAMPLE_IDS.ios) {
      logger.detail(`The Firebase app's bundle id is ${iosApp.namespace}. The simulator works as is; on a phone, set it under Signing & Capabilities.`);
    }
  }

  const androidApp = await nativeApp(ctx, "ANDROID", c.projectId, EXAMPLE_IDS.android);
  const androidConfig = androidApp && (await fb.sdkConfig("ANDROID", androidApp.appId, c.projectId));
  if (androidConfig) {
    writeFile(join(root, "examples/android/app/google-services.json"), androidConfig.fileContents);
    const packageName = androidPackage(androidConfig.fileContents, androidApp.appId) ?? androidApp.namespace ?? EXAMPLE_IDS.android;
    android = androidOptions(androidConfig.fileContents, packageName);
    const props = join(root, "examples/android/local.properties");
    const current = existsSync(props) ? readFileSync(props, "utf8") : undefined;
    writeFile(props, setProperty(current, "clayver.applicationId", packageName));
    logger.success("Android: examples/android/app/google-services.json");
  }

  if (ios || android) {
    for (const o of [ios, android]) if (o && !o.databaseURL && databaseURL) o.databaseURL = databaseURL;
    const dart = join(root, "examples/flutter/lib/firebase_options.dart");
    writeFile(dart, flutterOptionsFile(android, ios));
    // The file is a committed placeholder: keep these local values out of commits.
    await ctx.runner.run({ command: "git", args: ["update-index", "--skip-worktree", "examples/flutter/lib/firebase_options.dart"], cwd: root, mutating: true });
    logger.success("Flutter: examples/flutter/lib/firebase_options.dart");
  }
}

async function dashboardConfig(ctx: Ctx, root: string, c: DevConfig, databaseURL?: string) {
  const { logger, fb } = ctx;
  logger.step("Configuring the dashboard");
  const apps = (await fb.listApps("WEB", c.projectId)) ?? [];
  let appId = (apps.find((a) => a.displayName === DASHBOARD_WEB_APP_NAME) ?? apps[0])?.appId;
  if (!appId) {
    const created = await fb.createApp("WEB", DASHBOARD_WEB_APP_NAME, undefined, c.projectId);
    appId = created.appId;
    if (!appId) throw new ClayverError(`Could not register a web app: ${firstLine(created.result.stderr || created.result.stdout)}`);
    logger.success(`Registered the web app "${DASHBOARD_WEB_APP_NAME}"`);
  }
  const web = parseWebSdkConfig(await fb.webSdkConfig(appId, c.projectId));
  if (!web) throw new ClayverError("Could not read the web app's config (firebase apps:sdkconfig WEB).");
  if (!web.databaseURL && databaseURL) web.databaseURL = databaseURL;
  // Kept outside dashboard/: a .env.local there would be inlined into dashboard builds,
  // which the CLI refuses to bundle. dev:dashboard passes these values to Vite instead.
  writeFile(join(root, DASHBOARD_ENV), dashboardEnvFile(web, c));
  logger.success(DASHBOARD_ENV);
}

/** Signs in to Google Application Default Credentials (what firebase-admin uses) for this project. */
async function googleLogin(ctx: Ctx, projectId: string): Promise<boolean> {
  const { logger, prompter, runner } = ctx;
  if (!(await runner.which("gcloud"))) {
    logger.warn("Granting the role needs the gcloud CLI to sign you in to Google: https://cloud.google.com/sdk/docs/install");
    return false;
  }
  const ok = await prompter.confirm({
    message: `Granting the role needs your Google credentials. Sign in now? (use the Google account that owns ${projectId})`,
    default: true,
  });
  if (!ok) return false;
  const login = await runner.run({ command: "gcloud", args: ["auth", "application-default", "login"], mutating: false, interactive: true });
  if (login.exitCode !== 0) return false;
  const quota = await runner.run({ command: "gcloud", args: ["auth", "application-default", "set-quota-project", projectId], mutating: false, interactive: true });
  return quota.exitCode === 0;
}

async function makeAdmin(ctx: Ctx, c: DevConfig, databaseURL: string): Promise<string | undefined> {
  const { logger, prompter } = ctx;
  logger.step("Making you an admin");
  const email = await prompter.input({
    message: "Your email for the dashboard (an account is created if needed):",
    default: c.adminEmail ?? (await ctx.fb.loggedInAccount()),
    validate: (v) => EMAIL_PATTERN.test(v.trim()) || "Enter an email address.",
  });
  const grant = async () => {
    const backend = await createFirebaseAdminBackend(c.projectId, databaseURL);
    try {
      // grantRole prints the password setup link for a new account.
      await grantRole(backend, { workspace: c.workspace, email, role: "admin", create: true }, logger);
    } finally {
      await backend.close?.();
    }
  };
  try {
    try {
      await grant();
    } catch (e) {
      // firebase-admin uses Google Application Default Credentials; sign in once and retry.
      if (!(e instanceof ClayverError) || !(await googleLogin(ctx, c.projectId))) throw e;
      await grant();
    }
  } catch (e) {
    if (!(e instanceof ClayverError)) throw e;
    logger.warn(`Could not grant the role: ${e.message}`);
    if (e.hint) logger.info(e.hint);
    logger.info("Then run `pnpm dev:setup` again; it skips what is already done.");
  }
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------- commands

export async function runDevSetup(opts: DevOptions, deps: Deps): Promise<void> {
  const ctx = makeCtx(opts, deps);
  const root = findRepoRoot(deps.cwd);
  const saved = readDevConfig(root);
  ctx.logger.step("Clayver dev setup");
  const account = await ctx.fb.loggedInAccount();
  if (!account) throw new ClayverError("The Firebase CLI is not signed in.", "Run `firebase login`, then run this again.");
  ctx.logger.success(`Firebase CLI signed in as ${account}`);

  const projectId = await chooseProject(ctx, opts, saved);
  const c: DevConfig = {
    projectId,
    workspace: saved?.projectId === projectId ? saved.workspace : DEFAULT_WORKSPACE,
    region: saved?.projectId === projectId ? saved.region : DEFAULT_REGION,
    adminEmail: saved?.adminEmail,
  };
  writeFile(join(root, DEV_FILE), `${JSON.stringify(c, null, 2)}\n`);

  const databaseURL = (await checkProject(ctx, projectId)) ?? `https://${projectId}-default-rtdb.firebaseio.com`;
  await deploy(ctx, root, c);
  await dashboardConfig(ctx, root, c, databaseURL);
  await exampleApps(ctx, root, c, databaseURL);
  c.adminEmail = await makeAdmin(ctx, c, databaseURL);
  writeFile(join(root, DEV_FILE), `${JSON.stringify(c, null, 2)}\n`);

  ctx.logger.step("Ready");
  ctx.logger.info("pnpm dev:dashboard   start the dashboard on http://localhost:5173");
  ctx.logger.info("pnpm dev:deploy      redeploy after changing the rules or functions");
  ctx.logger.info("Example apps: open examples/ios/ClayverExample.xcodeproj, examples/android, or run `flutter run` in examples/flutter.");
}

export async function runDevDeploy(opts: DevOptions, deps: Deps): Promise<void> {
  const ctx = makeCtx(opts, deps);
  const root = findRepoRoot(deps.cwd);
  await deploy(ctx, root, requireDevConfig(root));
}

export async function runDevDashboard(opts: DevOptions, deps: Deps): Promise<void> {
  const ctx = makeCtx(opts, deps);
  const root = findRepoRoot(deps.cwd);
  const c = requireDevConfig(root);
  const envPath = join(root, DASHBOARD_ENV);
  if (!existsSync(envPath)) throw new ClayverError("The dashboard is not configured.", "Run `pnpm dev:setup` first.");
  ctx.logger.step(`Dashboard for ${c.projectId} on ${DASHBOARD_URL}`);
  const env = parseEnvFile(readFileSync(envPath, "utf8"));
  await ctx.runner.run({ command: "pnpm", args: ["--filter", "@clayver/dashboard", "dev"], cwd: root, mutating: false, interactive: true, env });
}
