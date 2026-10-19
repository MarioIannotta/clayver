import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLI_VERSION } from "../constants.js";
import { deployBackend, envFilePath, writeBackendFiles } from "../backend/apply.js";
import { parseEmails, parseEnvFile } from "../backend/functions.js";
import { loadAssets } from "../core/assets.js";
import { makeCtx, makeFileOps, type CommonOptions, type Deps } from "../core/context.js";
import { ClayverError } from "../core/errors.js";
import { manifestPath, requireManifest, serializeManifest, type ClayverManifest } from "../core/manifest.js";
import { checkNodeVersion } from "./init.js";

export interface UpdateOptions extends CommonOptions {
  /** `--no-deploy` */
  deploy?: boolean;
}

/**
 * Re-copies the rules and functions bundled with this CLI version into the
 * project (diff + confirmation for every change) and redeploys.
 */
export async function runUpdate(opts: UpdateOptions, deps: Deps): Promise<ClayverManifest> {
  const ctx = makeCtx(opts, deps);
  const { logger, fb, prompter, runner } = ctx;
  const appDir = resolve(deps.cwd, opts.dir ?? ".");
  const manifest = requireManifest(appDir);
  if (!manifest.backend || !manifest.firebaseProjectId) {
    throw new ClayverError("clayver.json has no backend setup to update.", "Run `npx clayver init` (without --skip-backend) first.");
  }
  const projectId = manifest.firebaseProjectId;
  checkNodeVersion(deps.nodeVersion ?? process.versions.node);
  if (!(await runner.which("firebase"))) {
    throw new ClayverError("The Firebase CLI (`firebase`) is not installed.", "npm install -g firebase-tools && firebase login");
  }
  if (!(await fb.loggedInAccount())) throw new ClayverError("The Firebase CLI is not signed in.", "Run `firebase login`.");

  const assets = loadAssets(deps.assetsDir);
  logger.step(`Updating Clayver in ${projectId}`);
  logger.info(`Installed CLI ${CLI_VERSION} (functions ${assets.meta.functionsVersion ?? "?"}); last applied by CLI ${manifest.cliVersion} (functions ${manifest.backend.assetsVersion ?? "?"}).`);
  if (ctx.dryRun) logger.info("Dry run: nothing will be written or deployed.");

  const files = makeFileOps(ctx, appDir, manifest.files);
  const firebaseDir = resolve(appDir, manifest.backend.firebaseDir);
  const env = parseEnvFile(files.readText(envFilePath(firebaseDir, projectId)));
  const admins = env.CLAYVER_BOOTSTRAP_ADMINS ? parseEmails(env.CLAYVER_BOOTSTRAP_ADMINS) : manifest.backend.bootstrapAdmins;
  const region = env.CLAYVER_FUNCTIONS_REGION ?? manifest.region;

  const result = await writeBackendFiles(ctx, files, {
    projectId,
    region,
    firebaseDir,
    assets,
    previous: manifest.backend,
    bootstrapAdmins: admins,
    dashboard: !!manifest.backend.hostingPublic,
    databaseURL: manifest.backend.databaseURL,
  });
  const backend = result.record;

  let deployStatus = manifest.steps.deploy;
  if (opts.deploy !== false) {
    logger.step("Deploy");
    const go = await prompter.confirm({ message: `Deploy the updated rules and functions to ${projectId}?`, default: true, yesDefault: true });
    if (go) {
      deployStatus = await deployBackend(ctx, { projectId, firebaseDir, hosting: !!backend.hostingPublic });
      if (deployStatus === "done") backend.deployedAt = ctx.now().toISOString();
    }
  }

  const updated: ClayverManifest = {
    ...manifest,
    cliVersion: CLI_VERSION,
    updatedAt: ctx.now().toISOString(),
    region,
    backend,
    steps: { ...manifest.steps, backend: result.status, ...(deployStatus ? { deploy: deployStatus } : {}) },
    files: [...files.records.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
  if (ctx.dryRun) logger.dryRun("would update clayver.json");
  else writeFileSync(manifestPath(appDir), serializeManifest(updated));
  logger.step("Done");
  logger.info(files.changed.length ? `${files.changed.length} change(s) applied.` : "Everything was already up to date.");
  return updated;
}
