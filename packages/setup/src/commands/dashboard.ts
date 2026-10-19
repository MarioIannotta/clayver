import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  DASHBOARD_CONFIG_FILE,
  DASHBOARD_DIR,
  DASHBOARD_PUBLIC_DIR,
  DASHBOARD_WEB_APP_NAME,
  DEFAULT_DASHBOARD_HOST,
  DEFAULT_DASHBOARD_PORT,
  DEFAULT_REGION,
  LINKS,
} from "../constants.js";
import { requireDashboardAssets } from "../core/assets.js";
import { makeCtx, makeFileOps, type CommonOptions, type Ctx, type Deps } from "../core/context.js";
import { ClayverError } from "../core/errors.js";
import type { FileOps } from "../core/files.js";
import { manifestPath, readManifest, serializeManifest, type ClayverManifest, type DashboardRecord, type StepStatus } from "../core/manifest.js";
import { firstLine } from "../firebase/cli.js";
import {
  DASHBOARD_GITIGNORE,
  dashboardConfigJson,
  dashboardPackageJson,
  dashboardReadme,
  parseWebSdkConfig,
  planDashboardFirebaseJson,
  type WebConfig,
} from "../dashboard/files.js";
import { createDashboardServer, displayUrl, listen } from "../dashboard/server.js";

/** Marker file in public/ so `deploy` knows it may replace the folder. Dotfiles are not deployed. */
const GENERATED_MARKER = ".clayver-generated";
const PLACEHOLDER = "<from firebase apps:sdkconfig WEB>";

function posix(p: string) {
  return p.split(sep).join("/");
}

// ---------------------------------------------------------------- init step

export interface DashboardStepInput {
  appDir: string;
  projectId: string;
  workspace: string;
  region: string;
  databaseURL?: string;
  previous?: DashboardRecord;
  /** The Firebase CLI is installed and signed in. */
  signedIn: boolean;
}

export interface DashboardStepResult {
  status: StepStatus;
  record?: DashboardRecord;
  notes: string[];
}

async function chooseWebApp(ctx: Ctx, projectId: string, previousId?: string): Promise<{ appId?: string; pending?: boolean }> {
  const { fb, logger, prompter } = ctx;
  const apps = await fb.listApps("WEB", projectId);
  if (apps === undefined) {
    logger.warn(`Could not list the web apps of ${projectId} (firebase apps:list WEB).`);
    return {};
  }
  const reuse = apps.find((a) => a.appId === previousId) ?? apps.find((a) => a.displayName === DASHBOARD_WEB_APP_NAME);
  if (reuse) {
    logger.success(`Using web app "${reuse.displayName ?? reuse.appId}" (${reuse.appId})`);
    return { appId: reuse.appId };
  }
  let create = true;
  if (apps.length) {
    const choice = await prompter.select({
      message: `Which Firebase web app should the dashboard use?`,
      choices: [
        { name: `Register a new web app "${DASHBOARD_WEB_APP_NAME}"`, value: "__create__" },
        ...apps.map((a) => ({ name: `${a.displayName ?? "(unnamed)"} (${a.appId})`, value: a.appId })),
      ],
      default: "__create__",
    });
    if (choice !== "__create__") return { appId: choice };
  } else {
    create = await prompter.confirm({
      message: `Register a web app "${DASHBOARD_WEB_APP_NAME}" in ${projectId} for the agent dashboard (firebase apps:create WEB)?`,
      default: true,
      yesDefault: true,
    });
  }
  if (!create) return {};
  const created = await fb.createApp("WEB", DASHBOARD_WEB_APP_NAME, undefined, projectId);
  if (created.result.skipped) return { pending: true };
  if (!created.appId) {
    logger.error(`firebase apps:create WEB failed: ${firstLine(created.result.stderr || created.result.stdout)}`);
    return {};
  }
  logger.success(`Registered web app "${DASHBOARD_WEB_APP_NAME}" (${created.appId})`);
  return { appId: created.appId };
}

async function defaultDatabaseURL(ctx: Ctx, projectId: string): Promise<string | undefined> {
  const instances = await ctx.fb.listDatabaseInstances(projectId);
  const def = instances?.find((i) => i.type === "DEFAULT_DATABASE") ?? instances?.[0];
  return def?.databaseUrl;
}

/** Fetches the web config of `appId`, filling databaseURL when Firebase leaves it out. */
async function webConfigFor(ctx: Ctx, appId: string, projectId: string, databaseURL?: string): Promise<WebConfig | undefined> {
  const web = parseWebSdkConfig(await ctx.fb.webSdkConfig(appId, projectId));
  if (!web) return undefined;
  if (!web.databaseURL) {
    const url = databaseURL ?? (await defaultDatabaseURL(ctx, projectId));
    if (url) web.databaseURL = url;
  }
  return web;
}

/**
 * `init` step "Agent dashboard": registers (or reuses) a Firebase web app and
 * writes clayver-dashboard/ with clayver.config.json, package.json
 * (`npm start` / `npm run deploy`), firebase.json, .gitignore and a README.
 */
export async function setupDashboard(ctx: Ctx, files: FileOps, input: DashboardStepInput): Promise<DashboardStepResult> {
  const { logger } = ctx;
  const notes: string[] = [];
  const dashDir = join(input.appDir, DASHBOARD_DIR);
  if (!input.signedIn) {
    logger.warn("The Firebase CLI is not signed in, so the dashboard's web app cannot be registered.");
    notes.push("Set up the agent dashboard later: `firebase login`, then `npx clayver init` again.");
    return { status: "skipped", notes };
  }
  const { appId, pending } = await chooseWebApp(ctx, input.projectId, input.previous?.webAppId);
  let web: WebConfig | undefined;
  if (appId) {
    web = await webConfigFor(ctx, appId, input.projectId, input.databaseURL);
    if (!web) logger.warn(`Could not read the web app config (firebase apps:sdkconfig WEB ${appId}).`);
  } else if (pending) {
    logger.dryRun(`would read its config with firebase apps:sdkconfig WEB <appId> and write ${files.rel(join(dashDir, DASHBOARD_CONFIG_FILE))}`);
    const databaseURL = input.databaseURL ?? (await defaultDatabaseURL(ctx, input.projectId));
    web = { apiKey: PLACEHOLDER, authDomain: `${input.projectId}.firebaseapp.com`, projectId: input.projectId, ...(databaseURL ? { databaseURL } : {}), appId: PLACEHOLDER };
  }
  if (!web) {
    notes.push(`Register a web app in ${LINKS.console(input.projectId)} and run \`npx clayver init\` again to generate ${DASHBOARD_DIR}/.`);
    return { status: appId ? "failed" : "skipped", notes, record: input.previous };
  }

  let status: StepStatus = "done";
  const configPath = join(dashDir, DASHBOARD_CONFIG_FILE);
  const firebaseJsonPath = join(dashDir, "firebase.json");
  const writes = [
    {
      path: configPath,
      content: dashboardConfigJson(files.readText(configPath), { firebase: web, workspace: input.workspace, region: input.region }),
      description: "Dashboard runtime config: Firebase web config (public), workspace and functions region",
    },
    { path: join(dashDir, "package.json"), content: dashboardPackageJson(), description: "`npm start` runs the dashboard locally, `npm run deploy` puts it on Firebase Hosting" },
    {
      path: firebaseJsonPath,
      content: planDashboardFirebaseJson(files.readText(firebaseJsonPath)).content,
      description: "Firebase Hosting config for `clayver dashboard deploy`",
    },
    { path: join(dashDir, ".gitignore"), content: DASHBOARD_GITIGNORE, description: "Keeps node_modules/ and the generated public/ out of git" },
    { path: join(dashDir, "README.md"), content: dashboardReadme({ projectId: input.projectId, workspace: input.workspace }), description: "How to run and deploy the dashboard", showDiff: false },
  ];
  for (const w of writes) {
    const outcome = await files.write({ ...w, kind: "dashboard" });
    if (outcome === "skipped") status = "partial";
  }
  const rel = posix(relative(input.appDir, dashDir));
  logger.info("Run the agent dashboard on this computer:");
  logger.info(`  cd ${rel} && npm install && npm start`);
  logger.detail(`(or, without installing: npx clayver dashboard start --dir ${rel})`);
  if (!web.databaseURL) {
    logger.warn(`The web config has no databaseURL yet. Create the Realtime Database, then run \`npx clayver init\` again.`);
    status = "partial";
  }
  notes.push(`Agent dashboard: \`cd ${rel} && npm install && npm start\`; put it online with \`npm run deploy\`.`);
  notes.push(`Optional: browser notifications for agents need a Web Push key (${LINKS.webPushCerts(input.projectId)}); put its public key in ${rel}/${DASHBOARD_CONFIG_FILE} as "vapidKey".`);
  return {
    status,
    notes,
    record: { ...input.previous, dir: rel, ...(appId ? { webAppId: appId } : {}) },
  };
}

// ---------------------------------------------------------------- dashboard start

export interface DashboardStartOptions extends CommonOptions {
  port?: string | number;
  host?: string;
}

export interface DashboardHandle {
  server: Server;
  url: string;
  port: number;
  configSource: string;
  close(): Promise<void>;
}

interface ConfigSource {
  label: string;
  read: () => string | undefined;
}

function fileSource(path: string, cwd: string): ConfigSource {
  const rel = relative(cwd, path);
  return { label: rel && !rel.startsWith("..") ? rel : path, read: () => (existsSync(path) ? readFileSync(path, "utf8") : undefined) };
}

async function startConfigSource(ctx: Ctx, opts: DashboardStartOptions, cwd: string): Promise<ConfigSource> {
  if (opts.dir) {
    const dir = resolve(cwd, opts.dir);
    const path = join(dir, DASHBOARD_CONFIG_FILE);
    if (!existsSync(path)) {
      throw new ClayverError(
        `No ${DASHBOARD_CONFIG_FILE} in ${dir}.`,
        `Run \`npx clayver init\` in your app (it writes ${DASHBOARD_DIR}/${DASHBOARD_CONFIG_FILE}), or pass --dir <that folder>.`,
      );
    }
    return fileSource(path, cwd);
  }
  const here = join(cwd, DASHBOARD_CONFIG_FILE);
  if (existsSync(here)) return fileSource(here, cwd);
  const m = readManifest(cwd);
  if (!m) {
    throw new ClayverError(
      `No ${DASHBOARD_CONFIG_FILE} or clayver.json in ${cwd}.`,
      `Run this in your app (after \`npx clayver init\`), in ${DASHBOARD_DIR}/, or pass --dir <dashboard folder>.`,
    );
  }
  const generated = m.dashboard ? join(cwd, m.dashboard.dir, DASHBOARD_CONFIG_FILE) : join(cwd, DASHBOARD_DIR, DASHBOARD_CONFIG_FILE);
  if (existsSync(generated)) return fileSource(generated, cwd);

  // No dashboard folder: build the config from the Firebase project (read-only CLI calls).
  const projectId = m.firebaseProjectId;
  if (!projectId) throw new ClayverError("clayver.json has no Firebase project.", "Run `npx clayver init` first.");
  if (!(await ctx.runner.which("firebase")) || !(await ctx.fb.loggedInAccount())) {
    throw new ClayverError(
      `No ${DASHBOARD_DIR}/${DASHBOARD_CONFIG_FILE}, and the Firebase CLI is not available to read the web config of ${projectId}.`,
      "Run `firebase login`, or `npx clayver init` to generate the dashboard folder.",
    );
  }
  let appId = m.dashboard?.webAppId;
  if (!appId) {
    const apps = (await ctx.fb.listApps("WEB", projectId)) ?? [];
    appId = (apps.find((a) => a.displayName === DASHBOARD_WEB_APP_NAME) ?? apps[0])?.appId;
  }
  if (!appId) {
    throw new ClayverError(`${projectId} has no Firebase web app.`, "Run `npx clayver init` (step \"Agent dashboard\") to register one.");
  }
  const web = await webConfigFor(ctx, appId, projectId, m.backend?.databaseURL);
  if (!web) throw new ClayverError(`Could not read the config of web app ${appId} (firebase apps:sdkconfig WEB).`);
  const body = dashboardConfigJson(undefined, { firebase: web, workspace: m.workspace, region: m.region ?? DEFAULT_REGION });
  return { label: `web app ${appId} of ${projectId} (from clayver.json)`, read: () => body };
}

function parsePort(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new ClayverError(`Invalid --port "${value}".`, "Use a number between 1 and 65535.");
  return n;
}

/** `clayver dashboard start`: serves the bundled dashboard with the generated clayver.config.json. */
export async function runDashboardStart(opts: DashboardStartOptions, deps: Deps): Promise<DashboardHandle> {
  const ctx = makeCtx({ ...opts, dryRun: false }, deps);
  const { logger } = ctx;
  const root = requireDashboardAssets(deps.assetsDir);
  const source = await startConfigSource(ctx, opts, deps.cwd);
  const body = source.read();
  try {
    const cfg = JSON.parse(body ?? "") as { firebase?: { apiKey?: string; databaseURL?: string }; projectId?: string };
    if (!cfg.firebase?.apiKey) logger.warn(`${source.label} has no firebase.apiKey; the dashboard will show "not configured".`);
    else if (cfg.firebase.apiKey === PLACEHOLDER) logger.warn(`${source.label} still holds placeholders from a dry run. Run \`npx clayver init\`.`);
    if (cfg.firebase && !cfg.firebase.databaseURL) logger.warn(`${source.label} has no firebase.databaseURL.`);
  } catch (e) {
    logger.warn(`${source.label} is not valid JSON (${(e as Error).message}); the dashboard will show "not configured".`);
  }
  const explicitPort = parsePort(opts.port);
  const host = opts.host ?? DEFAULT_DASHBOARD_HOST;
  const server = createDashboardServer({ root, readConfig: source.read });
  let port: number;
  try {
    port = await listen(server, explicitPort ?? DEFAULT_DASHBOARD_PORT, host, explicitPort === undefined ? 10 : 0);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EADDRINUSE") throw new ClayverError(`Port ${explicitPort} on ${host} is already in use.`, "Pass another one with --port <n>.");
    throw e;
  }
  const url = displayUrl(host, port);
  logger.success(`Clayver dashboard running at ${url}`);
  logger.detail(`config: ${source.label}`);
  logger.detail(`files: ${root}`);
  if (host !== DEFAULT_DASHBOARD_HOST && host !== "localhost") {
    logger.warn(`Listening on ${host}: other computers on the network can open the dashboard. Add that host name to Firebase Auth's authorized domains for Google sign-in.`);
  }
  logger.info("Press Ctrl+C to stop.");
  return {
    server,
    url,
    port,
    configSource: source.label,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

// ---------------------------------------------------------------- dashboard deploy

export interface DashboardDeployOptions extends CommonOptions {
  project?: string;
  site?: string;
}

function findManifestFor(dashDir: string, cwd: string): { dir: string; manifest: ClayverManifest } | undefined {
  for (const dir of [...new Set([cwd, dirname(dashDir)])]) {
    const m = readManifest(dir);
    if (m?.dashboard && resolve(dir, m.dashboard.dir) === dashDir) return { dir, manifest: m };
  }
  return undefined;
}

function resolveDashboardDir(opts: DashboardDeployOptions, cwd: string): string {
  if (opts.dir) return resolve(cwd, opts.dir);
  if (existsSync(join(cwd, DASHBOARD_CONFIG_FILE))) return cwd;
  const m = readManifest(cwd);
  if (m?.dashboard) return resolve(cwd, m.dashboard.dir);
  if (existsSync(join(cwd, DASHBOARD_DIR, DASHBOARD_CONFIG_FILE))) return join(cwd, DASHBOARD_DIR);
  throw new ClayverError(`No dashboard folder found in ${cwd}.`, "Run `npx clayver init` first, or pass --dir <dashboard folder>.");
}

export interface DashboardDeployResult {
  status: StepStatus;
  url?: string;
  dashboardDir: string;
}

/**
 * `clayver dashboard deploy`: makes sure the dashboard folder's firebase.json
 * has a hosting entry for public/, fills public/ with the bundled dashboard and
 * clayver.config.json, and runs `firebase deploy --only hosting`.
 */
export async function runDashboardDeploy(opts: DashboardDeployOptions, deps: Deps): Promise<DashboardDeployResult> {
  const ctx = makeCtx(opts, deps);
  const { logger, prompter, fb, runner } = ctx;
  const dashDir = resolveDashboardDir(opts, deps.cwd);
  const configPath = join(dashDir, DASHBOARD_CONFIG_FILE);
  if (!existsSync(configPath)) {
    throw new ClayverError(`No ${DASHBOARD_CONFIG_FILE} in ${dashDir}.`, "Run `npx clayver init` to generate it.");
  }
  let config: { firebase?: { projectId?: string } };
  try {
    config = JSON.parse(readFileSync(configPath, "utf8")) as typeof config;
  } catch (e) {
    throw new ClayverError(`${configPath} is not valid JSON: ${(e as Error).message}`);
  }
  const owner = findManifestFor(dashDir, deps.cwd);
  const projectId = opts.project ?? config.firebase?.projectId ?? owner?.manifest.firebaseProjectId ?? undefined;
  if (!projectId) throw new ClayverError("Which Firebase project?", `Pass --project, or set firebase.projectId in ${DASHBOARD_CONFIG_FILE}.`);
  const assets = requireDashboardAssets(deps.assetsDir);

  logger.step(`Deploying the agent dashboard to Firebase Hosting (${projectId})`);
  if (ctx.dryRun) logger.info("Dry run: nothing will be written or deployed.");
  if (!(await runner.which("firebase"))) {
    throw new ClayverError("The Firebase CLI (`firebase`) is not installed.", "npm install -g firebase-tools && firebase login");
  }
  if (!(await fb.loggedInAccount())) throw new ClayverError("The Firebase CLI is not signed in.", "Run `firebase login`.");

  // 1. firebase.json with a hosting target serving public/.
  const files = makeFileOps(ctx, owner?.dir ?? dashDir, owner?.manifest.files);
  const fjPath = join(dashDir, "firebase.json");
  const plan = planDashboardFirebaseJson(files.readText(fjPath), opts.site);
  if (plan.conflict) logger.warn(`${files.rel(fjPath)} has a hosting entry that does not serve ${DASHBOARD_PUBLIC_DIR}/; Clayver proposes to replace it.`);
  const fjOutcome = await files.write({
    path: fjPath,
    content: plan.content,
    kind: "dashboard",
    description: "Firebase Hosting config for `clayver dashboard deploy`",
    safe: !plan.conflict,
  });
  if (fjOutcome === "skipped") {
    throw new ClayverError(`${files.rel(fjPath)} was left unchanged, so there is no hosting target to deploy.`);
  }

  // 2. public/: the bundled dashboard + clayver.config.json.
  const publicDir = join(dashDir, DASHBOARD_PUBLIC_DIR);
  const foreign = existsSync(publicDir) && readdirSync(publicDir).length > 0 && !existsSync(join(publicDir, GENERATED_MARKER));
  if (foreign) {
    const ok = ctx.dryRun
      ? true
      : await prompter.confirm({
          message: `${files.rel(publicDir)}/ has files Clayver did not put there. Replace its contents with the dashboard?`,
          default: false,
          yesDefault: false,
        });
    if (!ok) throw new ClayverError(`Left ${files.rel(publicDir)}/ unchanged.`, "Move your files elsewhere; Clayver regenerates that folder on every deploy.");
  }
  if (ctx.dryRun) {
    logger.dryRun(`would ${foreign ? "replace" : "fill"} ${files.rel(publicDir)}/ with the bundled dashboard and ${DASHBOARD_CONFIG_FILE}`);
  } else {
    rmSync(publicDir, { recursive: true, force: true });
    mkdirSync(publicDir, { recursive: true });
    cpSync(assets, publicDir, { recursive: true });
    writeFileSync(join(publicDir, DASHBOARD_CONFIG_FILE), readFileSync(configPath));
    writeFileSync(join(publicDir, GENERATED_MARKER), "Generated by `clayver dashboard deploy`; replaced on every deploy.\n");
    logger.success(`${files.rel(publicDir)}/ ready`);
  }

  // 3. Deploy.
  const site = plan.site ?? projectId;
  const url = `https://${site}.web.app`;
  const go = await prompter.confirm({
    message: `Deploy the dashboard to Firebase Hosting site "${site}" (${url})? It replaces what that site serves now.`,
    default: true,
    yesDefault: true,
  });
  let status: StepStatus = "skipped";
  if (go) {
    const r = await fb.deploy(["hosting"], projectId, dashDir, ctx.yes);
    if (r.skipped) status = "skipped";
    else if (r.exitCode !== 0) {
      logger.error(`firebase deploy --only hosting failed.${plan.site ? ` Does the Hosting site "${plan.site}" exist (firebase hosting:sites:create ${plan.site})?` : ""}`);
      status = "failed";
    } else {
      status = "done";
      logger.success(`Dashboard deployed: ${url}`);
      if (plan.site && plan.site !== projectId) {
        logger.info(`Add ${site}.web.app to the authorized domains for Google sign-in: ${LINKS.authorizedDomains(projectId)}`);
      }
      logger.info(`Push notifications can link to it: set CLAYVER_DASHBOARD_URL=${url} in the functions' .env file and run \`npx clayver update\`.`);
    }
  }

  // 4. Manifest.
  if (owner && !ctx.dryRun) {
    const m = owner.manifest;
    const dashboard: DashboardRecord = {
      ...(m.dashboard as DashboardRecord),
      ...(status === "done" ? { hosting: { ...(plan.site ? { site: plan.site } : {}), url, deployedAt: ctx.now().toISOString() } } : {}),
    };
    const updated: ClayverManifest = {
      ...m,
      updatedAt: ctx.now().toISOString(),
      dashboard,
      files: [...files.records.values()].sort((a, b) => a.path.localeCompare(b.path)),
    };
    writeFileSync(manifestPath(owner.dir), serializeManifest(updated));
  }
  return { status, url: status === "done" ? url : undefined, dashboardDir: dashDir };
}

/** Folders the dashboard tools create that are not recorded file by file (npm install, deploy). */
export const DASHBOARD_GENERATED = ["node_modules", DASHBOARD_PUBLIC_DIR, ".firebase", "package-lock.json"];
