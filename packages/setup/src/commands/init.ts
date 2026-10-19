import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  CLI_VERSION,
  DASHBOARD_DIR,
  DEFAULT_REGION,
  DEFAULT_WORKSPACE,
  FIREBASE_PROJECT_PATTERN,
  FUNCTIONS_DIR,
  LINKS,
  MIN_NODE,
  SDK,
  WORKSPACE_PATTERN,
} from "../constants.js";
import { deployBackend, envFilePath, writeBackendFiles } from "../backend/apply.js";
import { parseEmails, parseEnvFile, validateEmails } from "../backend/functions.js";
import { loadAssets } from "../core/assets.js";
import { makeCtx, makeFileOps, type CommonOptions, type Ctx, type Deps } from "../core/context.js";
import { ClayverError } from "../core/errors.js";
import type { FileOps } from "../core/files.js";
import {
  manifestPath,
  readManifest,
  serializeManifest,
  type BackendRecord,
  type ClayverManifest,
  type DashboardRecord,
  type Platform,
  type StepName,
  type StepStatus,
} from "../core/manifest.js";
import { appIdentifier, detectApps, type DetectedApp } from "../detect/platform.js";
import { dependencyEditFor, dependencyInstructions } from "../example/dependencies.js";
import { exampleFiles } from "../example/templates.js";
import { expectedConfigPath, findFirebaseConfigs } from "../firebase/config-files.js";
import { billingEnabled, enableAuthProviders, gcloudAccessToken, getAuthProviders } from "../firebase/gcp.js";
import { postNotificationsEdit, pushGuidance } from "../push/push.js";
import { setupDashboard } from "./dashboard.js";

export interface InitOptions extends CommonOptions {
  platform?: Platform;
  project?: string;
  workspace?: string;
  region?: string;
  /** Comma-separated bootstrap admin emails (skips the question). */
  admins?: string;
  skipBackend?: boolean;
  skipPush?: boolean;
  skipExample?: boolean;
  /** Do not register a web app or generate clayver-dashboard/. */
  skipDashboard?: boolean;
  /** `--no-deploy`: write files but do not run `firebase deploy`. */
  deploy?: boolean;
}

export interface InitResult {
  manifest: ClayverManifest;
  appDir: string;
  dryRun: boolean;
}

interface State {
  steps: Partial<Record<StepName, StepStatus>>;
  notes: string[];
  account?: string;
  app?: DetectedApp;
  appDir: string;
  projectId?: string;
  backend?: BackendRecord;
  dashboard?: DashboardRecord;
  region?: string;
  manifestExisted?: boolean;
  appInfo: ClayverManifest["app"];
}

// ---------------------------------------------------------------- 1. prerequisites

export function checkNodeVersion(version: string) {
  const [major = 0, minor = 0] = version.replace(/^v/, "").split(".").map(Number);
  if (major < MIN_NODE.major || (major === MIN_NODE.major && minor < MIN_NODE.minor)) {
    throw new ClayverError(
      `Node.js ${MIN_NODE.major}.${MIN_NODE.minor} or newer is required (found ${version}).`,
      "Install the current LTS from https://nodejs.org or with your version manager (nvm install --lts).",
    );
  }
}

async function prerequisites(ctx: Ctx, opts: InitOptions, s: State) {
  const { logger, runner, fb } = ctx;
  logger.step("1. Prerequisites");
  const node = ctx.deps.nodeVersion ?? process.versions.node;
  checkNodeVersion(node);
  logger.success(`Node.js ${node}`);
  const needFirebase = !opts.skipBackend || !opts.project;
  if (!(await runner.which("firebase"))) {
    if (needFirebase) {
      throw new ClayverError(
        "The Firebase CLI (`firebase`) is not installed or not on your PATH.",
        `Install it with \`npm install -g firebase-tools\` (${LINKS.firebaseCli}), run \`firebase login\`, then run \`npx clayver init\` again.`,
      );
    }
    logger.warn("Firebase CLI not found; continuing because the backend step is skipped.");
  } else {
    const version = await fb.version();
    logger.success(`Firebase CLI ${version ?? ""}`.trim());
    s.account = await fb.loggedInAccount();
    if (!s.account && needFirebase) {
      throw new ClayverError(
        "The Firebase CLI is not signed in.",
        "Run `firebase login` (or `firebase login --no-localhost` over SSH), then run `npx clayver init` again.",
      );
    }
    if (s.account) logger.success(`Signed in to Firebase as ${s.account}`);
  }
  s.steps.prerequisites = "done";
}

async function platformTools(ctx: Ctx, app: DetectedApp) {
  const { logger, runner } = ctx;
  if (app.platform === "flutter" && !(await runner.which("flutter"))) {
    logger.warn("`flutter` is not on your PATH. Install Flutter (https://docs.flutter.dev/get-started/install) to build the app.");
  }
  const podfile = app.platform === "ios" ? app.ios?.podfile : app.flutter?.ios?.podfile;
  if (podfile && !(await runner.which("pod"))) {
    logger.warn("The project uses CocoaPods but `pod` is not installed: `sudo gem install cocoapods` or `brew install cocoapods`.");
  }
}

// ---------------------------------------------------------------- 2. app

async function chooseApp(ctx: Ctx, opts: InitOptions, s: State): Promise<DetectedApp> {
  const { logger, prompter } = ctx;
  logger.step("2. App");
  const root = resolve(ctx.deps.cwd, opts.dir ?? ".");
  if (!existsSync(root)) throw new ClayverError(`Directory ${root} does not exist.`, "Pass --dir <path to your app>.");
  const found = detectApps(root);
  let app: DetectedApp | undefined;
  if (opts.platform) {
    app = found.find((a) => a.platform === opts.platform);
    if (!app) {
      logger.warn(`No ${opts.platform} project detected in ${root}; using it as the app directory anyway.`);
      app = { platform: opts.platform, dir: root, evidence: ["--platform flag"] };
    }
  } else if (found.length === 1) {
    app = found[0];
  } else if (found.length > 1) {
    const choice = await prompter.select({
      message: "Several apps were found. Which one should Clayver set up?",
      choices: found.map((a, i) => ({ name: `${a.platform} — ${relative(root, a.dir) || "."} (${a.evidence.join(", ")})`, value: String(i) })),
      flagHint: "--platform <ios|android|flutter> and/or --dir <path>",
    });
    app = found[Number(choice)];
  } else {
    logger.warn(`No iOS, Android or Flutter project detected in ${root}.`);
    const platform = await prompter.select<Platform>({
      message: "Which platform is this app?",
      choices: [
        { name: "iOS (Swift)", value: "ios" },
        { name: "Android (Kotlin)", value: "android" },
        { name: "Flutter", value: "flutter" },
      ],
      flagHint: "--platform <ios|android|flutter>",
    });
    app = { platform, dir: root, evidence: ["chosen manually"] };
  }
  if (!app) throw new ClayverError("No app selected.");
  s.appDir = app.dir;
  s.app = app;
  logger.success(`${app.platform} app in ${app.dir}`);
  logger.detail(`detected from: ${app.evidence.join(", ")}`);
  const ids = appIdentifier(app);
  if (ids.ios) logger.detail(`iOS bundle id: ${ids.ios}`);
  if (ids.android) logger.detail(`Android application id: ${ids.android}`);
  s.appInfo = { bundleId: ids.ios, applicationId: ids.android };
  await platformTools(ctx, app);
  s.steps.app = "done";
  return app;
}

// ---------------------------------------------------------------- 3. Firebase project

async function chooseProject(ctx: Ctx, opts: InitOptions, s: State, files: FileOps, previous?: ClayverManifest): Promise<string> {
  const { logger, prompter, fb, runner } = ctx;
  const app = s.app as DetectedApp;
  logger.step("3. Firebase project");
  const configs = findFirebaseConfigs(app);
  for (const c of configs) logger.detail(`${relative(s.appDir, c.file) || c.file}: project ${c.projectId ?? "?"}`);
  const detected = [...new Set(configs.map((c) => c.projectId).filter((p): p is string => !!p))];
  const validate = (v: string) => FIREBASE_PROJECT_PATTERN.test(v) || "Firebase project ids are 6-30 lowercase letters, digits and dashes.";

  let projectId = opts.project;
  if (projectId) {
    const ok = validate(projectId);
    if (ok !== true) throw new ClayverError(`Invalid --project "${projectId}". ${ok}`);
  } else if (s.account) {
    const projects = await fb.listProjects();
    const proposal = [previous?.firebaseProjectId ?? undefined, ...detected].find((p) => p && projects.some((x) => x.projectId === p));
    if (detected.length && !proposal) logger.warn(`The app's config points at ${detected.join(", ")}, which your account cannot see.`);
    const choice = await prompter.select({
      message: "Which Firebase project should host Clayver?",
      choices: [
        ...projects.map((p) => ({
          name: `${p.projectId}${p.displayName && p.displayName !== p.projectId ? ` (${p.displayName})` : ""}${p.projectId === proposal ? "  ← detected" : ""}`,
          value: p.projectId,
        })),
        { name: "Create a new Firebase project…", value: "__create__" },
      ],
      default: proposal,
      flagHint: "--project <firebaseProjectId>",
    });
    if (choice === "__create__") {
      projectId = await prompter.input({ message: "New project id:", validate, flagHint: "--project" });
      const name = await prompter.input({ message: "Display name:", default: projectId });
      const r = await fb.createProject(projectId, name);
      if (!r.skipped && r.exitCode !== 0) throw new ClayverError(`Could not create project ${projectId}.`, "Create it in the Firebase console and run init again with --project.");
    } else {
      projectId = choice;
    }
  } else {
    projectId = await prompter.input({ message: "Firebase project id:", default: detected[0], validate, flagHint: "--project" });
  }
  s.projectId = projectId;
  logger.success(`Firebase project: ${projectId}  (${LINKS.console(projectId)})`);
  const mismatched = configs.filter((c) => c.kind !== "firebaserc" && c.projectId && c.projectId !== projectId);
  for (const c of mismatched) {
    logger.warn(`${relative(s.appDir, c.file)} belongs to project ${c.projectId}, not ${projectId}. The app will talk to ${c.projectId} until you replace it.`);
  }

  // App registration and config file.
  const firebaseOk = s.account !== undefined;
  for (const expected of expectedConfigPath(app)) {
    const present = configs.some(
      (c) => c.projectId === projectId && (c.kind === (expected.platform === "IOS" ? "GoogleService-Info.plist" : "google-services.json") || c.kind === "firebase_options.dart"),
    );
    if (present) {
      logger.success(`${expected.platform === "IOS" ? "GoogleService-Info.plist" : "google-services.json"} found for ${projectId}`);
      continue;
    }
    if (app.platform === "flutter") continue;
    if (!firebaseOk) {
      logger.warn(`No Firebase config file for ${projectId}. Download it from ${LINKS.console(projectId)} (Project settings > Your apps).`);
      continue;
    }
    await registerNativeApp(ctx, s, files, expected.platform, join(s.appDir, expected.path), projectId);
  }
  if (app.platform === "flutter" && !configs.some((c) => c.kind === "firebase_options.dart" && c.projectId === projectId)) {
    logger.warn(`lib/firebase_options.dart for ${projectId} is missing. FlutterFire generates it together with the native config files.`);
    if (await runner.which("flutterfire")) {
      const go = await prompter.confirm({ message: `Run \`flutterfire configure --project=${projectId}\` now?`, default: true, yesDefault: false });
      if (go) {
        const r = await runner.run({ command: "flutterfire", args: ["configure", `--project=${projectId}`], cwd: s.appDir, mutating: true, interactive: true });
        if (!r.skipped && r.exitCode !== 0) logger.warn("flutterfire configure failed; run it yourself before building the app.");
        s.notes.push("FlutterFire wrote lib/firebase_options.dart and the native config files; they are yours and `clayver remove` leaves them.");
      } else s.notes.push(`Run \`flutterfire configure --project=${projectId}\` in ${s.appDir}.`);
    } else {
      s.notes.push(`Install the FlutterFire CLI (\`dart pub global activate flutterfire_cli\`) and run \`flutterfire configure --project=${projectId}\` (${LINKS.flutterfire}).`);
    }
  }
  s.steps.firebaseProject = "done";
  return projectId;
}

async function registerNativeApp(ctx: Ctx, s: State, files: FileOps, platform: "IOS" | "ANDROID", target: string, projectId: string) {
  const { logger, prompter, fb } = ctx;
  const ids = appIdentifier(s.app as DetectedApp);
  let identifier = platform === "IOS" ? ids.ios : ids.android;
  const label = platform === "IOS" ? "bundle id" : "package name";
  if (!identifier) {
    identifier = await prompter.input({ message: `The app's ${label}:`, validate: (v) => /^[A-Za-z][\w.-]*$/.test(v) || `Enter a valid ${label}.` });
  }
  const apps = (await fb.listApps(platform, projectId)) ?? [];
  let appId = apps.find((a) => a.namespace === identifier)?.appId;
  if (appId) logger.success(`${platform} app ${identifier} is registered in ${projectId} (${appId})`);
  else {
    const ok = await prompter.confirm({
      message: `Register ${platform === "IOS" ? "iOS" : "Android"} app ${identifier} in ${projectId} (firebase apps:create)?`,
      default: true,
      yesDefault: true,
    });
    if (!ok) {
      s.notes.push(`Register the ${platform} app ${identifier} in ${LINKS.console(projectId)} and add its config file.`);
      return;
    }
    const created = await fb.createApp(platform, identifier, identifier, projectId);
    if (created.result.skipped) {
      logger.dryRun(`would download its config to ${files.rel(target)} (firebase apps:sdkconfig ${platform} <appId>)`);
      return;
    }
    appId = created.appId;
    if (!appId) {
      logger.error(`firebase apps:create failed. Register the app in ${LINKS.console(projectId)} and download the config file.`);
      return;
    }
    logger.success(`Registered ${identifier} (${appId})`);
  }
  s.appInfo.firebaseAppId = appId;
  const cfg = await fb.sdkConfig(platform, appId, projectId);
  if (!cfg) {
    logger.warn(`Could not download the config (firebase apps:sdkconfig ${platform} ${appId}). Get it from the console.`);
    return;
  }
  await files.write({
    path: target,
    content: cfg.fileContents,
    kind: "app-config",
    description: `Firebase config of the ${platform === "IOS" ? "iOS" : "Android"} app (public identifiers, no secrets)`,
    showDiff: false,
  });
  s.appInfo.configFile = files.rel(target);
  if (platform === "IOS") s.notes.push(`Add ${files.rel(target)} to your app target in Xcode (drag it in, tick "Copy items if needed" and the target).`);
}

// ---------------------------------------------------------------- 4. backend

async function projectServices(ctx: Ctx, projectId: string): Promise<string | undefined> {
  const { logger, fb, prompter } = ctx;
  const instances = await fb.listDatabaseInstances(projectId);
  let databaseURL: string | undefined;
  if (instances && instances.length === 0) {
    logger.warn(`${projectId} has no Realtime Database yet. Create one (any location) at ${LINKS.database(projectId)}.`);
    if (!ctx.dryRun) {
      const ok = await prompter.confirm({ message: "Continue (create it before deploying)?", default: true, yesDefault: true });
      if (!ok) throw new ClayverError("Stopped before setting up the backend.", "Create the Realtime Database, then run `npx clayver init` again.");
    }
  } else if (instances) {
    const def = instances.find((i) => i.type === "DEFAULT_DATABASE") ?? instances[0];
    databaseURL = def?.databaseUrl;
    if (databaseURL) logger.success(`Realtime Database: ${databaseURL}`);
  }

  const token = await gcloudAccessToken(ctx.runner);
  if (!token) {
    logger.info(`Clayver needs the Blaze (pay-as-you-go) plan for Cloud Functions: ${LINKS.usage(projectId)}`);
    logger.info(`Enable Anonymous and Email/Password (and optionally Google) sign-in: ${LINKS.authProviders(projectId)}`);
    logger.info(`Create the default Storage bucket if you haven't: ${LINKS.storage(projectId)}`);
    return databaseURL;
  }
  const deps = { runner: ctx.runner, fetch: ctx.fetch };
  const billing = await billingEnabled(deps, projectId, token);
  if (billing === false) logger.warn(`Billing is not enabled on ${projectId}. Upgrade to Blaze before deploying: ${LINKS.usage(projectId)}`);
  else if (billing) logger.success("Blaze plan (billing enabled)");
  const providers = await getAuthProviders(deps, projectId, token);
  if (!providers) {
    logger.info(`Check that Anonymous and Email/Password sign-in are enabled: ${LINKS.authProviders(projectId)}`);
  } else {
    if (!providers.anonymous || !providers.emailPassword) {
      const ok = await prompter.confirm({
        message: "Enable Anonymous (app customers) and Email/Password (dashboard agents) sign-in in this project?",
        default: true,
        yesDefault: true,
      });
      if (ok && ctx.dryRun) logger.dryRun("would enable Anonymous and Email/Password sign-in (Identity Toolkit API)");
      else if (ok && (await enableAuthProviders(deps, projectId, token))) logger.success("Anonymous and Email/Password sign-in enabled");
      else logger.warn(`Enable them in the console: ${LINKS.authProviders(projectId)}`);
    } else logger.success("Anonymous and Email/Password sign-in are enabled");
    if (providers.google === false) logger.info(`Optional: enable Google sign-in for agents at ${LINKS.authProviders(projectId)}`);
  }
  return databaseURL;
}

async function chooseFirebaseDir(ctx: Ctx, s: State, previous?: ClayverManifest): Promise<string> {
  if (previous?.backend?.firebaseDir) return resolve(s.appDir, previous.backend.firebaseDir);
  if (existsSync(join(s.appDir, "firebase.json"))) return s.appDir;
  const parent = dirname(s.appDir);
  if (parent !== s.appDir && existsSync(join(parent, "firebase.json"))) {
    const use = await ctx.prompter.confirm({
      message: `Use the existing ${join(parent, "firebase.json")} for Clayver's backend?`,
      default: true,
      yesDefault: true,
    });
    if (use) return parent;
  }
  return s.appDir;
}

async function backend(ctx: Ctx, opts: InitOptions, s: State, files: FileOps, previous?: ClayverManifest) {
  const { logger, prompter } = ctx;
  logger.step("4. Backend (rules, Cloud Functions, deploy)");
  if (opts.skipBackend) {
    logger.info("Skipped (--skip-backend).");
    s.steps.backend = "skipped";
    s.backend = previous?.backend;
    return;
  }
  const projectId = s.projectId as string;
  const assets = loadAssets(ctx.deps.assetsDir);
  const firebaseDir = await chooseFirebaseDir(ctx, s, previous);
  logger.detail(`Firebase directory: ${firebaseDir}`);
  const databaseURL = await projectServices(ctx, projectId);

  const env = parseEnvFile(files.readText(envFilePath(firebaseDir, projectId)));
  const region = opts.region ?? env.CLAYVER_FUNCTIONS_REGION ?? previous?.region ?? DEFAULT_REGION;
  s.region = region;
  const adminsDefault = opts.admins ?? env.CLAYVER_BOOTSTRAP_ADMINS ?? previous?.backend?.bootstrapAdmins.join(",") ?? s.account;
  const adminsAnswer = opts.admins
    ? opts.admins
    : await prompter.input({
        message: "Email(s) allowed to become the first Clayver admin (comma separated):",
        default: adminsDefault,
        validate: validateEmails,
        flagHint: "--admins <emails>",
      });
  const adminsValid = validateEmails(adminsAnswer);
  if (adminsValid !== true) throw new ClayverError(`Invalid --admins: ${adminsValid}`);
  const bootstrapAdmins = parseEmails(adminsAnswer);

  // The agent dashboard has its own step (clayver-dashboard/ + `clayver dashboard deploy`).
  // Only setups made by older CLI versions still serve it from the backend's firebase.json.
  const dashboard = !!previous?.backend?.hostingPublic;

  const result = await writeBackendFiles(ctx, files, {
    projectId,
    region,
    firebaseDir,
    assets,
    previous: previous?.backend,
    bootstrapAdmins,
    dashboard,
    databaseURL,
  });
  s.backend = result.record;
  s.steps.backend = result.status;

  logger.step("4b. Deploy");
  if (opts.deploy === false) {
    logger.info("Skipped (--no-deploy). Deploy later with `npx clayver update`.");
    s.steps.deploy = "skipped";
    return;
  }
  const go = await prompter.confirm({
    message: `Deploy Clayver's database rules, storage rules and functions to ${projectId} now?`,
    default: true,
    yesDefault: true,
  });
  if (!go) {
    s.steps.deploy = "skipped";
    s.notes.push("Deploy with `npx clayver update` (or `firebase deploy --only database,storage,functions:clayver`).");
    return;
  }
  logger.info("Note: deploying `database` and `storage` publishes the whole rules files, including your own rules.");
  const status = await deployBackend(ctx, { projectId, firebaseDir, hosting: result.hostingAdded });
  s.steps.deploy = status;
  if (status === "done") s.backend.deployedAt = ctx.now().toISOString();
}

// ---------------------------------------------------------------- 5. push

async function push(ctx: Ctx, opts: InitOptions, s: State, files: FileOps) {
  const { logger } = ctx;
  logger.step("5. Push notifications");
  if (opts.skipPush) {
    logger.info("Skipped (--skip-push).");
    s.steps.push = "skipped";
    return;
  }
  const app = s.app as DetectedApp;
  for (const line of pushGuidance(app, s.projectId ?? "<project>")) logger.info(line);
  const android = app.platform === "flutter" ? app.flutter?.android : app.android;
  if (android?.manifest) {
    const path = join(s.appDir, android.manifest);
    const text = files.readText(path);
    const edit = postNotificationsEdit(android.manifest);
    const next = text !== undefined ? edit.apply(text) : undefined;
    if (next !== undefined) {
      logger.info("Clayver can declare POST_NOTIFICATIONS in your AndroidManifest.xml:");
      await files.write({
        path,
        content: next,
        kind: "platform-config",
        description: "Declares android.permission.POST_NOTIFICATIONS (Android 13+)",
        reversal: { type: "lines", lines: edit.lines },
      });
    }
  }
  s.steps.push = "done";
}

// ---------------------------------------------------------------- 6. example

async function example(ctx: Ctx, opts: InitOptions, s: State, files: FileOps) {
  const { logger } = ctx;
  logger.step("6. Example integration");
  if (opts.skipExample) {
    logger.info("Skipped (--skip-example).");
    s.steps.example = "skipped";
    return;
  }
  const app = s.app as DetectedApp;
  const workspace = opts.workspace ?? DEFAULT_WORKSPACE;
  const region = s.region ?? opts.region ?? DEFAULT_REGION;
  for (const f of exampleFiles(app, { workspace, region })) {
    await files.write({ path: join(s.appDir, f.path), content: f.content, kind: "example", description: f.description, showDiff: false });
  }
  logger.info("Add the Clayver SDK to your app:");
  for (const line of dependencyInstructions(app)) logger.info(`  ${line}`);
  const edit = dependencyEditFor(app);
  const status: StepStatus = "done";
  if (edit) {
    const path = join(s.appDir, edit.file);
    const text = files.readText(path);
    const next = text !== undefined ? edit.apply(text) : undefined;
    if (text === undefined) logger.detail(`${edit.file} not found; add the dependency by hand.`);
    else if (next === undefined) logger.detail(`${edit.file}: Clayver dependency already present (or no place to insert it found).`);
    else {
      logger.info(`Clayver can add the dependency to ${edit.file} for you:`);
      const outcome = await files.write({
        path,
        content: next,
        kind: "dependency",
        description: "Adds the Clayver SDK dependency",
        reversal: { type: "lines", lines: edit.lines },
      });
      if (outcome === "skipped") s.notes.push(`Add the Clayver SDK dependency to ${edit.file} (see the instructions above).`);
      else if (ctx.dryRun) logger.detail("(dry run: the dependency edit above needs your confirmation)");
      else if (app.platform === "flutter") s.notes.push("Run `flutter pub get`.");
      else if (app.platform === "ios") s.notes.push("Run `pod install`.");
      else s.notes.push("Sync Gradle.");
    }
  } else if (app.platform === "ios") {
    s.notes.push(`Add the Swift package ${SDK.ios.spmUrl} in Xcode (File > Add Package Dependencies…).`);
  }
  s.steps.example = status;
}

// ---------------------------------------------------------------- 7. dashboard

async function dashboardStep(ctx: Ctx, opts: InitOptions, s: State, files: FileOps, previous?: ClayverManifest) {
  const { logger } = ctx;
  logger.step("7. Agent dashboard");
  s.dashboard = previous?.dashboard;
  if (opts.skipDashboard) {
    logger.info("Skipped (--skip-dashboard).");
    s.steps.dashboard = "skipped";
    return;
  }
  if (!s.projectId) {
    s.steps.dashboard = "skipped";
    return;
  }
  const r = await setupDashboard(ctx, files, {
    appDir: s.appDir,
    projectId: s.projectId,
    workspace: opts.workspace ?? DEFAULT_WORKSPACE,
    region: s.region ?? opts.region ?? DEFAULT_REGION,
    databaseURL: s.backend?.databaseURL ?? previous?.backend?.databaseURL,
    previous: previous?.dashboard,
    signedIn: s.account !== undefined,
  });
  s.notes.push(...r.notes);
  s.dashboard = r.record;
  s.steps.dashboard = r.status;
}

// ---------------------------------------------------------------- 8. manifest + summary

function buildManifest(ctx: Ctx, opts: InitOptions, s: State, files: FileOps, previous?: ClayverManifest): ClayverManifest {
  const now = ctx.now().toISOString();
  return {
    manifestVersion: 1,
    cliVersion: CLI_VERSION,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    platform: s.app?.platform ?? previous?.platform ?? null,
    firebaseProjectId: s.projectId ?? previous?.firebaseProjectId ?? null,
    workspace: opts.workspace ?? previous?.workspace ?? DEFAULT_WORKSPACE,
    region: s.region ?? opts.region ?? previous?.region ?? DEFAULT_REGION,
    app: { ...previous?.app, ...Object.fromEntries(Object.entries(s.appInfo).filter(([, v]) => v !== undefined)) },
    ...(s.backend ? { backend: s.backend } : {}),
    ...(s.dashboard ? { dashboard: s.dashboard } : {}),
    steps: { ...previous?.steps, ...s.steps },
    files: [...files.records.values()].sort((a, b) => a.path.localeCompare(b.path)),
    ...(s.notes.length ? { notes: s.notes } : {}),
  };
}

function printSummary(ctx: Ctx, m: ClayverManifest, files: FileOps, s: State) {
  const { logger } = ctx;
  logger.step(ctx.dryRun ? "Summary (dry run — nothing was written or deployed)" : "Summary");
  const label: Record<StepName, string> = {
    prerequisites: "Prerequisites",
    app: "App detection",
    firebaseProject: "Firebase project",
    backend: "Backend files",
    deploy: "Deploy",
    push: "Push notifications",
    example: "Example integration",
    dashboard: "Agent dashboard",
  };
  for (const key of Object.keys(label) as StepName[]) {
    const st = s.steps[key];
    if (!st) continue;
    const text = `${label[key]}: ${st}`;
    if (st === "done") logger.success(text);
    else if (st === "failed" || st === "partial") logger.warn(text);
    else logger.info(`- ${text}`);
  }
  logger.info("");
  logger.info(ctx.dryRun ? "Files that would be created or modified:" : "Files Clayver created or modified (recorded in clayver.json):");
  const byDir = new Map<string, number>();
  for (const r of m.files) {
    // Functions source and (legacy) dashboard static files are summarised per folder.
    if (r.kind === "functions" || (r.kind === "dashboard" && r.description.startsWith("Clayver dashboard (static build"))) {
      const parts = r.path.split("/");
      const i = parts.findIndex((p) => p === FUNCTIONS_DIR || p === DASHBOARD_DIR);
      const key = parts.slice(0, i + 1).join("/");
      byDir.set(key, (byDir.get(key) ?? 0) + 1);
      continue;
    }
    logger.info(`  ${r.action === "created" ? "+" : "~"} ${r.path} — ${r.description}`);
  }
  for (const [dir, count] of byDir) {
    logger.info(`  + ${dir}/ — ${count} file(s): ${dir.endsWith("dashboard") ? "Clayver dashboard static build" : "Clayver Cloud Functions source (deployed as the `clayver` codebase)"}`);
  }
  logger.info(`  ${s.manifestExisted ? "~" : "+"} clayver.json — this manifest: what Clayver configured and every file above, used by \`clayver status/update/remove\``);
  logger.info("");
  logger.info("Next steps:");
  for (const n of m.notes ?? []) logger.info(`  • ${n}`);
  if (m.firebaseProjectId) {
    logger.info(`  • Make yourself an admin: npx clayver admin grant --email <you@example.com> --role admin`);
    logger.info(`  • Check the setup any time: npx clayver status`);
  }
}

export async function runInit(options: InitOptions, deps: Deps): Promise<InitResult> {
  const ctx = makeCtx(options, deps);
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;
  if (!WORKSPACE_PATTERN.test(workspace)) {
    throw new ClayverError(`Invalid --workspace "${workspace}".`, "Use 1-40 lowercase letters, digits and dashes (default: \"default\").");
  }
  if (ctx.dryRun) ctx.logger.info("Dry run: Clayver prints every change and command but writes and deploys nothing.");
  const s: State = { steps: {}, notes: [], appDir: resolve(deps.cwd, options.dir ?? "."), appInfo: {} };

  await prerequisites(ctx, options, s);
  const app = await chooseApp(ctx, options, s);
  const previous = readManifest(app.dir);
  s.manifestExisted = !!previous;
  if (previous) ctx.logger.info(`Found clayver.json from a previous run (${previous.updatedAt}); init will update it.`);
  const opts: InitOptions = { ...options, workspace: options.workspace ?? previous?.workspace };
  // Region priority: --region, then the functions .env file (read in the backend step), then clayver.json.
  s.region = options.region ?? previous?.region;
  const files = makeFileOps(ctx, s.appDir, previous?.files);
  let manifest: ClayverManifest | undefined;
  try {
    await chooseProject(ctx, opts, s, files, previous);
    await backend(ctx, opts, s, files, previous);
    await push(ctx, opts, s, files);
    await example(ctx, opts, s, files);
    await dashboardStep(ctx, opts, s, files, previous);
  } finally {
    manifest = buildManifest(ctx, opts, s, files, previous);
    if (ctx.dryRun) ctx.logger.dryRun(`would ${previous ? "update" : "create"} ${files.rel(manifestPath(s.appDir))}`);
    else if (files.records.size || previous) writeFileSync(manifestPath(s.appDir), serializeManifest(manifest));
  }
  printSummary(ctx, manifest, files, s);
  return { manifest, appDir: s.appDir, dryRun: ctx.dryRun };
}
