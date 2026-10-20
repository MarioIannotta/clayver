import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { functionsFileChanges } from "../backend/functions.js";
import { CLI_VERSION, FUNCTIONS_CODEBASE, FUNCTIONS_DIR } from "../constants.js";
import { loadAssets } from "../core/assets.js";
import { makeCtx, type CommonOptions, type Deps } from "../core/context.js";
import { sha256 } from "../core/hash.js";
import { requireManifest, type ClayverManifest } from "../core/manifest.js";

export interface StatusOptions extends CommonOptions {
  /** Also query the deployed functions (`firebase functions:list`). */
  remote?: boolean;
}

export type FileState = "ok" | "modified" | "missing";

export interface StatusReport {
  manifest: ClayverManifest;
  files: { path: string; state: FileState; action: string; description: string }[];
  /** True when the functions folder does not yet depend on this CLI version. */
  updateAvailable: boolean;
  deployedFunctions?: string[];
}

export async function runStatus(opts: StatusOptions, deps: Deps): Promise<StatusReport> {
  const ctx = makeCtx({ ...opts, dryRun: false }, deps);
  const { logger, fb } = ctx;
  const appDir = resolve(deps.cwd, opts.dir ?? ".");
  const m = requireManifest(appDir);

  logger.step("Clayver setup");
  logger.info(`App:              ${m.platform ?? "?"} (${appDir})`);
  logger.info(`Firebase project: ${m.firebaseProjectId ?? "not set"}`);
  logger.info(`Workspace:        ${m.workspace}`);
  logger.info(`Functions region: ${m.region}`);
  logger.info(`Configured with:  clayver ${m.cliVersion} (installed: ${CLI_VERSION}), last change ${m.updatedAt}`);
  for (const [step, st] of Object.entries(m.steps)) logger.detail(`${step}: ${st}`);
  if (m.backend) {
    const b = m.backend;
    logger.info(`Backend:          ${b.firebaseDir}/ → ${b.databaseRules}, ${b.storageRules}, ${b.functionsDir}/ (codebase "${b.functionsCodebase}")`);
    logger.info(`Last deploy:      ${b.deployedAt ?? "never"}`);
    logger.info(`Bootstrap admins: ${b.bootstrapAdmins.join(", ") || "none"}`);
  }

  logger.step("Files");
  const files: StatusReport["files"] = [];
  for (const r of m.files) {
    const abs = resolve(appDir, r.path);
    const state: FileState = !existsSync(abs) ? "missing" : sha256(readFileSync(abs)) === r.sha256 ? "ok" : "modified";
    files.push({ path: r.path, state, action: r.action, description: r.description });
    if (r.kind === "functions" && state === "ok") continue;
    const text = `${r.path} (${r.action}) — ${state === "ok" ? "unchanged" : state === "modified" ? "edited since Clayver wrote it" : "missing"}`;
    if (state === "ok") logger.success(text);
    else logger.warn(text);
  }
  const fnFiles = files.filter((f) => m.files.find((r) => r.path === f.path)?.kind === "functions");
  if (fnFiles.length) logger.success(`${FUNCTIONS_DIR}/: ${fnFiles.filter((f) => f.state === "ok").length}/${fnFiles.length} file(s) unchanged`);

  let updateAvailable = false;
  if (m.backend) {
    try {
      const assets = loadAssets(deps.assetsDir);
      const functionsDir = join(appDir, m.backend.firebaseDir, FUNCTIONS_DIR);
      for (const change of functionsFileChanges(assets, functionsDir)) {
        if (change.path.endsWith(".gitignore")) continue;
        const want = typeof change.content === "string" ? Buffer.from(change.content) : change.content;
        const disk = existsSync(change.path) ? readFileSync(change.path) : undefined;
        if (!disk || !disk.equals(want)) updateAvailable = true;
      }
      logger.step("Updates");
      if (updateAvailable) logger.warn(`The functions folder does not depend on this CLI yet (${assets.meta.functionsVersion ?? CLI_VERSION}). Run \`npx clayver update\`.`);
      else logger.success("The functions folder depends on this CLI version.");
    } catch (e) {
      logger.detail(`Could not compare with bundled assets: ${(e as Error).message}`);
    }
  }

  let deployedFunctions: string[] | undefined;
  if (opts.remote && m.firebaseProjectId) {
    logger.step("Deployed functions");
    const list = await fb.listFunctions(m.firebaseProjectId);
    if (!list) logger.warn("Could not list functions (is the Firebase CLI signed in?).");
    else {
      const names = new Set(m.backend?.functionNames ?? []);
      deployedFunctions = list.filter((f) => f.codebase === FUNCTIONS_CODEBASE || names.has(f.id)).map((f) => `${f.id} (${f.region ?? "?"})`);
      if (!deployedFunctions.length) logger.warn("No Clayver functions are deployed.");
      for (const f of deployedFunctions) logger.success(f);
    }
  }
  if (m.notes?.length) {
    logger.step("Open items from setup");
    for (const n of m.notes) logger.info(`• ${n}`);
  }
  return { manifest: m, files, updateAvailable, deployedFunctions };
}
