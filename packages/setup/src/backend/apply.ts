import { join, relative, sep } from "node:path";
import { DASHBOARD_DIR, FUNCTIONS_CODEBASE, FUNCTIONS_DIR, LINKS } from "../constants.js";
import type { Assets } from "../core/assets.js";
import type { Ctx } from "../core/context.js";
import type { FileOps } from "../core/files.js";
import type { BackendRecord, StepStatus } from "../core/manifest.js";
import { firstLine } from "../firebase/cli.js";
import { mergeDatabaseRules } from "./database-rules.js";
import { planFirebaseJson, planFirebaserc } from "./firebase-json.js";
import { functionsEnvFile, functionsFileChanges, parseEnvFile } from "./functions.js";
import { manualStorageSnippet, mergeStorageRules } from "./storage-rules.js";

export interface BackendInput {
  projectId: string;
  region: string;
  firebaseDir: string;
  assets: Assets;
  previous?: BackendRecord;
  bootstrapAdmins: string[];
  /** Deploy the bundled dashboard to Firebase Hosting. */
  dashboard: boolean;
  databaseURL?: string;
}

export interface BackendFilesResult {
  record: BackendRecord;
  status: StepStatus;
  hostingAdded: boolean;
}

function posix(p: string) {
  return p.split(sep).join("/");
}

export function envFilePath(firebaseDir: string, projectId: string) {
  return join(firebaseDir, FUNCTIONS_DIR, `.env.${projectId}`);
}

/**
 * Writes firebase.json, merges the database and storage rules, copies the
 * functions source and writes its parameters. Shared by `init` and `update`.
 */
export async function writeBackendFiles(ctx: Ctx, files: FileOps, input: BackendInput): Promise<BackendFilesResult> {
  const { logger } = ctx;
  const { firebaseDir, assets, previous, projectId } = input;
  let status: StepStatus = "done";

  // firebase.json
  const firebaseJsonPath = join(firebaseDir, "firebase.json");
  const fjExisting = files.readText(firebaseJsonPath);
  let hostingPublic = input.dashboard && assets.dashboardFiles ? DASHBOARD_DIR : undefined;
  const plan = planFirebaseJson(fjExisting, { hostingPublic });
  plan.warnings.forEach((w) => logger.warn(w));
  if (plan.hostingConflict) {
    logger.warn(
      "firebase.json already has a hosting configuration, so the dashboard was not added. " +
        `Add a second hosting site (https://firebase.google.com/docs/hosting/multisites) serving ${DASHBOARD_DIR}/ if you want it.`,
    );
    hostingPublic = undefined;
  }
  const fjOutcome = await files.write({
    path: firebaseJsonPath,
    content: plan.content,
    kind: "firebase-config",
    description: "Firebase CLI config: rules files, the `clayver` functions codebase" + (plan.hostingAdded ? ", dashboard hosting" : ""),
    safe: true,
    reversal: plan.reversal,
  });
  if (fjOutcome === "skipped") status = "partial";

  // database.rules.json
  const dbPath = join(firebaseDir, plan.databaseRules);
  const dbExisting = files.readText(dbPath);
  const db = mergeDatabaseRules(dbExisting, assets.databaseRules, previous?.databaseRulesSubtreeHash);
  db.warnings.forEach((w) => logger.warn(w));
  let databaseRulesSubtreeHash = previous?.databaseRulesSubtreeHash;
  if (db.status === "unchanged") {
    logger.success(`${files.rel(dbPath)}: Clayver rules already up to date`);
    databaseRulesSubtreeHash = db.subtreeHash;
  } else {
    if (db.status === "conflict") logger.warn(db.conflict ?? "conflict in database rules");
    if (db.status === "added") logger.info(`Merging the "clayver" subtree into ${files.rel(dbPath)}; your other rules stay as they are.`);
    const outcome = await files.write({
      path: dbPath,
      content: db.content,
      kind: "database-rules",
      description: "Realtime Database rules; Clayver owns only the rules.clayver subtree",
      safe: db.status !== "conflict",
      reversal: dbExisting !== undefined ? { type: "json-remove", paths: [["rules", "clayver"]] } : undefined,
    });
    if (outcome === "skipped") status = "partial";
    else databaseRulesSubtreeHash = db.subtreeHash;
  }

  // storage.rules
  const stPath = join(firebaseDir, plan.storageRules);
  const stExisting = files.readText(stPath);
  const st = mergeStorageRules(stExisting, assets.storageRules, previous?.storageRulesBlockHash);
  st.warnings.forEach((w) => logger.warn(w));
  let storageRulesBlockHash = previous?.storageRulesBlockHash;
  if (st.status === "manual") {
    logger.warn(st.conflict ?? "storage.rules needs a manual merge");
    logger.raw(manualStorageSnippet(assets.storageRules));
    status = "partial";
  } else if (st.status === "unchanged") {
    logger.success(`${files.rel(stPath)}: Clayver rules already up to date`);
    storageRulesBlockHash = st.blockHash;
  } else {
    if (st.status === "conflict") logger.warn(st.conflict ?? "conflict in storage rules");
    const outcome = await files.write({
      path: stPath,
      content: st.content,
      kind: "storage-rules",
      description: "Cloud Storage rules; Clayver owns only the block between the `>>> clayver` / `<<< clayver` markers",
      safe: st.status !== "conflict",
      reversal: stExisting !== undefined ? { type: "storage-rules-block" } : undefined,
    });
    if (outcome === "skipped") status = "partial";
    else storageRulesBlockHash = st.blockHash;
  }

  // Functions source
  const functionsDir = join(firebaseDir, FUNCTIONS_DIR);
  const changes = functionsFileChanges(assets, functionsDir);
  const wanted = new Set(changes.map((c) => files.rel(c.path)));
  const stale = [...files.records.values()]
    .filter((r) => r.kind === "functions" && r.path.startsWith(`${files.rel(functionsDir)}/`) && !wanted.has(r.path))
    .map((r) => files.abs(r.path));
  const group = await files.writeGroup(`${files.rel(functionsDir)}/ (Clayver Cloud Functions)`, changes, stale);
  if (!group.applied) status = "partial";

  // Function parameters
  const envPath = envFilePath(firebaseDir, projectId);
  const env = parseEnvFile(files.readText(envPath));
  const dashboardUrl = hostingPublic ? `https://${projectId}.web.app` : env.CLAYVER_DASHBOARD_URL;
  const envOutcome = await files.write({
    path: envPath,
    content: functionsEnvFile({
      projectId,
      bootstrapAdmins: input.bootstrapAdmins,
      region: input.region,
      dashboardUrl,
      enforceAppCheck: env.CLAYVER_ENFORCE_APP_CHECK === "true",
      extra: env,
    }),
    kind: "functions-env",
    description: `Function parameters for ${projectId}: bootstrap admins, region, dashboard URL, App Check. Not secret.`,
    safe: files.isUntouchedClayverFile(envPath),
  });
  if (envOutcome === "skipped") status = "partial";

  // Dashboard static files
  if (hostingPublic && assets.dashboardFiles) {
    const dashDir = join(firebaseDir, DASHBOARD_DIR);
    const dash = [...assets.dashboardFiles].map(([rel, content]) => ({
      path: join(dashDir, ...rel.split("/")),
      content,
      kind: "dashboard" as const,
      description: "Clayver dashboard (static build served by Firebase Hosting)",
      showDiff: false,
    }));
    const r = await files.writeGroup(`${files.rel(dashDir)}/ (Clayver dashboard)`, dash);
    if (!r.applied) status = "partial";
  }

  // .firebaserc
  const rcPath = join(firebaseDir, ".firebaserc");
  const rc = planFirebaserc(files.readText(rcPath), projectId);
  if (rc.warning) logger.warn(rc.warning);
  if (rc.content !== files.readText(rcPath)) {
    await files.write({
      path: rcPath,
      content: rc.content,
      kind: "firebase-config",
      description: "Default Firebase project for the Firebase CLI",
      safe: true,
      reversal: rc.reversal,
    });
  }

  const record: BackendRecord = {
    firebaseDir: posix(relative(files.abs("."), firebaseDir)) || ".",
    databaseRules: posix(relative(firebaseDir, dbPath)),
    storageRules: posix(relative(firebaseDir, stPath)),
    functionsDir: FUNCTIONS_DIR,
    functionsCodebase: FUNCTIONS_CODEBASE,
    functionNames: assets.meta.functionNames,
    databaseURL: input.databaseURL ?? previous?.databaseURL,
    bootstrapAdmins: input.bootstrapAdmins,
    databaseRulesSubtreeHash,
    storageRulesBlockHash,
    hostingPublic,
    assetsVersion: assets.meta.functionsVersion ?? assets.meta.cliVersion,
    deployedAt: previous?.deployedAt,
  };
  return { record, status, hostingAdded: !!hostingPublic };
}

/** `npm install` in the functions folder, then `firebase deploy`. */
export async function deployBackend(
  ctx: Ctx,
  input: { projectId: string; firebaseDir: string; hosting: boolean; only?: string[] },
): Promise<StepStatus> {
  const { logger, runner, fb } = ctx;
  const functionsDir = join(input.firebaseDir, FUNCTIONS_DIR);
  const install = await runner.run({
    command: "npm",
    args: ["install", "--omit=dev", "--no-audit", "--no-fund"],
    cwd: functionsDir,
    mutating: true,
  });
  if (!install.skipped && install.exitCode !== 0) {
    logger.error(`npm install failed in ${FUNCTIONS_DIR}: ${firstLine(install.stderr || install.stdout)}`);
    return "failed";
  }
  const only = input.only ?? ["database", "storage", `functions:${FUNCTIONS_CODEBASE}`, ...(input.hosting ? ["hosting"] : [])];
  logger.info(`Deploying ${only.join(", ")} to ${input.projectId}. The first functions deploy takes a few minutes.`);
  const r = await fb.deploy(only, input.projectId, input.firebaseDir, ctx.yes);
  if (r.skipped) return "skipped";
  if (r.exitCode !== 0) {
    logger.error("firebase deploy failed. Common causes:");
    logger.detail(`• The project is on the Spark plan. Cloud Functions and secrets need Blaze: ${LINKS.usage(input.projectId)}`);
    logger.detail(`• No Realtime Database or Storage bucket yet: ${LINKS.database(input.projectId)} / ${LINKS.storage(input.projectId)}`);
    logger.detail("• APIs still enabling on a new project: wait a minute, then run `npx clayver update`.");
    return "failed";
  }
  logger.success("Deployed.");
  return "done";
}
