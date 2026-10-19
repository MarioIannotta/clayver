import { existsSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FUNCTIONS_CODEBASE, FUNCTIONS_DIR } from "../constants.js";
import { removeDatabaseRules } from "../backend/database-rules.js";
import { isEmptyJsonObject, revertFirebaseJson } from "../backend/firebase-json.js";
import { removeStorageRules } from "../backend/storage-rules.js";
import { makeCtx, makeFileOps, type CommonOptions, type Ctx, type Deps } from "../core/context.js";
import type { FileOps } from "../core/files.js";
import { sha256 } from "../core/hash.js";
import { removeProperty } from "../core/jsonedit.js";
import { manifestPath, requireManifest, serializeManifest, type ClayverManifest, type FileRecord, type Reversal } from "../core/manifest.js";
import { removeLines } from "../example/dependencies.js";
import { DASHBOARD_GENERATED } from "./dashboard.js";

export interface RemoveOptions extends CommonOptions {
  /** Delete the deployed `clayver` functions codebase without asking. */
  deleteFunctions?: boolean;
  /** Offer to delete Clayver's data (still requires typing the project id). */
  deleteData?: boolean;
}

export interface RemoveResult {
  removed: string[];
  kept: string[];
  manifestDeleted: boolean;
}

/** Applies a recorded reversal to a file's current text. */
export function applyReversal(text: string, reversal: Reversal | undefined, record: FileRecord): string | undefined {
  if (!reversal) {
    // Older records without a reversal: best effort by kind.
    if (record.kind === "database-rules") return removeDatabaseRules(text);
    if (record.kind === "storage-rules") return removeStorageRules(text);
    return undefined;
  }
  switch (reversal.type) {
    case "json-remove":
      return reversal.paths.reduce((t, p) => removeProperty(t, p), text);
    case "storage-rules-block":
      return removeStorageRules(text);
    case "firebase-json":
      return revertFirebaseJson(text, reversal);
    case "lines":
      return removeLines(text, reversal.lines);
  }
}

async function removeFile(ctx: Ctx, files: FileOps, r: FileRecord, removed: string[], kept: string[]) {
  const abs = files.abs(r.path);
  if (!existsSync(abs)) {
    files.forget(abs);
    removed.push(r.path);
    return;
  }
  const text = files.readText(abs) ?? "";
  const untouched = sha256(Buffer.from(text)) === r.sha256 || files.isUntouchedClayverFile(abs);
  const deleteIt = async () => {
    if (await files.deleteCreated(abs)) {
      removed.push(r.path);
      files.pruneEmptyDirs(dirname(abs));
    } else kept.push(r.path);
  };
  if (r.action === "created" && untouched) return deleteIt();
  // Modified (or created, then edited by the developer): undo only Clayver's part.
  const reverted = applyReversal(text, r.reversal, r);
  if (reverted === undefined) {
    if (r.action === "created") return deleteIt(); // asks, because the file was edited
    ctx.logger.warn(`${r.path}: no record of how to undo Clayver's change; left as is.`);
    kept.push(r.path);
    return;
  }
  if (r.action === "created" && (reverted.trim() === "" || isEmptyJsonObject(reverted))) {
    if (await files.deleteCreated(abs, { askAlways: true })) removed.push(r.path);
    else kept.push(r.path);
    return;
  }
  if (reverted === text) {
    files.forget(abs);
    removed.push(r.path);
    return;
  }
  ctx.logger.info(`Removing Clayver's changes from ${r.path}:`);
  if (await files.revert(abs, reverted, r.description)) removed.push(r.path);
  else kept.push(r.path);
}

/**
 * Reverses what clayver.json recorded. Deployed functions are deleted only on
 * request, and data only after the developer types the project id.
 */
export async function runRemove(opts: RemoveOptions, deps: Deps): Promise<RemoveResult> {
  const ctx = makeCtx(opts, deps);
  const { logger, prompter, fb } = ctx;
  const appDir = resolve(deps.cwd, opts.dir ?? ".");
  const m: ClayverManifest = requireManifest(appDir);
  const project = m.firebaseProjectId;
  logger.step(`Removing Clayver from ${appDir}${project ? ` (Firebase project ${project})` : ""}`);
  if (ctx.dryRun) logger.info("Dry run: nothing will be deleted.");

  // 1. Cloud resources (opt-in).
  if (m.backend && project) {
    const delFns =
      opts.deleteFunctions ||
      (await prompter.confirm({
        message: `Delete the deployed Clayver Cloud Functions (codebase "${FUNCTIONS_CODEBASE}") from ${project}?`,
        default: false,
        yesDefault: false,
      }));
    if (delFns) {
      const r = await fb.deleteCodebase(m.backend.functionsCodebase ?? FUNCTIONS_CODEBASE, project);
      if (!r.skipped && r.exitCode !== 0) logger.warn("Deleting the functions failed; delete them in the Firebase console (Functions).");
      else if (!r.skipped) logger.success("Deleted the Clayver functions.");
    } else {
      logger.info(`Deployed functions kept. Delete later with: firebase functions:delete ${FUNCTIONS_CODEBASE} --project ${project}`);
    }

    const wantsData =
      opts.deleteData ||
      (!ctx.yes &&
        (await prompter.confirm({
          message: "Also permanently delete Clayver's data (all conversations, messages, customers, agents)?",
          default: false,
          yesDefault: false,
        })));
    if (wantsData) {
      const typed = await prompter.typed({
        message: `This permanently deletes /clayver from the Realtime Database of ${project}. It cannot be undone.`,
        expected: project,
      });
      if (typed) {
        const r = await fb.databaseRemove("/clayver", project);
        if (!r.skipped && r.exitCode !== 0) logger.error("Deleting /clayver failed; nothing else was removed from the database.");
        else if (!r.skipped) logger.success("Deleted /clayver from the Realtime Database.");
        logger.info("Attachments are in Cloud Storage under clayver/. Delete them with:");
        logger.info(`  gcloud storage rm --recursive "gs://<your-bucket>/clayver/"   (bucket: Firebase console > Storage)`);
      } else {
        logger.info("Confirmation did not match; Clayver data was NOT deleted.");
      }
    } else {
      logger.info("Clayver data in the database and storage was kept.");
    }
  }

  // 2. Files, deepest paths first.
  const files = makeFileOps(ctx, appDir, m.files);
  const removed: string[] = [];
  const kept: string[] = [];
  const records = [...m.files].sort((a, b) => b.path.split("/").length - a.path.split("/").length || b.path.localeCompare(a.path));
  for (const r of records) await removeFile(ctx, files, r, removed, kept);

  // npm install output in the functions folder is not recorded; remove it with the folder.
  if (m.backend) {
    const fnDir = join(resolve(appDir, m.backend.firebaseDir), m.backend.functionsDir ?? FUNCTIONS_DIR);
    const nodeModules = join(fnDir, "node_modules");
    const fnKept = kept.some((k) => resolve(appDir, k).startsWith(fnDir));
    if (existsSync(nodeModules) && !fnKept) {
      if (ctx.dryRun) logger.dryRun(`would delete ${files.rel(nodeModules)}/ (installed dependencies)`);
      else rmSync(nodeModules, { recursive: true, force: true });
    }
    for (const lock of ["package-lock.json"]) {
      const p = join(fnDir, lock);
      if (existsSync(p) && !fnKept && !ctx.dryRun) unlinkSync(p);
    }
    files.pruneEmptyDirs(fnDir);
  }

  // The dashboard folder: npm install output and the deploy's public/ are not recorded file by file.
  if (m.dashboard) {
    const dashDir = resolve(appDir, m.dashboard.dir);
    const dashKept = kept.some((k) => resolve(appDir, k).startsWith(`${dashDir}/`));
    if (!dashKept && existsSync(dashDir)) {
      for (const name of DASHBOARD_GENERATED) {
        const p = join(dashDir, name);
        if (!existsSync(p)) continue;
        if (ctx.dryRun) logger.dryRun(`would delete ${files.rel(p)}`);
        else rmSync(p, { recursive: true, force: true });
      }
      files.pruneEmptyDirs(dashDir);
    }
    if (m.dashboard.webAppId && project) {
      logger.info(
        `The Firebase web app ${m.dashboard.webAppId} stays registered in ${project}. Delete it in Project settings > Your apps if nothing else uses it.`,
      );
    }
    if (m.dashboard.hosting) logger.info(`The dashboard stays online at ${m.dashboard.hosting.url} until you run \`firebase hosting:disable --project ${project}\`.`);
  }

  // 3. Live rules.
  if (m.backend && project && !ctx.dryRun) {
    const fbDir = resolve(appDir, m.backend.firebaseDir);
    const rulesLeft = existsSync(join(fbDir, "firebase.json"));
    if (rulesLeft) {
      const redeploy = await prompter.confirm({
        message: "Deploy your rules files now so Clayver's rules are removed from the live project?",
        default: false,
        yesDefault: false,
      });
      if (redeploy) await fb.deploy(["database", "storage"], project, fbDir, ctx.yes);
      else logger.info("Live rules still contain Clayver's rules until you deploy: firebase deploy --only database,storage");
    } else {
      logger.info("The live project keeps Clayver's rules until you deploy new ones (firebase deploy --only database,storage).");
    }
  }

  // 4. Manifest.
  let manifestDeleted = false;
  const remaining = [...files.records.values()];
  if (ctx.dryRun) logger.dryRun(remaining.length ? "would keep clayver.json for the kept files" : "would delete clayver.json");
  else if (!remaining.length) {
    unlinkSync(manifestPath(appDir));
    manifestDeleted = true;
  } else {
    writeFileSync(manifestPath(appDir), serializeManifest({ ...m, updatedAt: ctx.now().toISOString(), files: remaining }));
  }
  logger.step("Done");
  logger.info(`${removed.length} file(s) removed or restored${kept.length ? `, ${kept.length} kept: ${kept.join(", ")}` : ""}.`);
  if (manifestDeleted) logger.success("clayver.json deleted. Clayver is no longer configured in this app.");
  return { removed, kept, manifestDeleted };
}
