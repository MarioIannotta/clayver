import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isProbablyText, renderDiff, truncateLines } from "./diff.js";
import { sha256 } from "./hash.js";
import type { Logger } from "./logger.js";
import { mergeReversal, type FileKind, type FileRecord, type Reversal } from "./manifest.js";
import type { Prompter } from "./prompter.js";

export interface FileChange {
  /** Absolute path. */
  path: string;
  content: string | Buffer;
  kind: FileKind;
  /** One line shown in the summary: what the file is for. */
  description: string;
  /**
   * The change only adds Clayver's own entries to an existing file (e.g. a new
   * `clayver` key). `--yes` accepts safe changes; anything else needs a human.
   */
  safe?: boolean;
  /** How `clayver remove` undoes this change if the file existed before. */
  reversal?: Reversal;
  /** Print the diff of a newly created file (default: true for small text files). */
  showDiff?: boolean;
}

export type WriteOutcome = "created" | "updated" | "unchanged" | "skipped";

export interface FileOpsOptions {
  /** Directory that holds clayver.json; record paths are relative to it. */
  baseDir: string;
  dryRun: boolean;
  prompter: Prompter;
  logger: Logger;
  /** Records from an earlier run (clayver.json), used for ownership checks. */
  previous?: FileRecord[];
  color?: boolean;
  verbose?: boolean;
}

/**
 * The only way Clayver touches the developer's files. It
 * - never overwrites an existing file without showing a diff and asking,
 * - writes nothing in dry-run (it prints what it would do),
 * - records every created or modified file for clayver.json.
 */
export class FileOps {
  readonly records = new Map<string, FileRecord>();
  private readonly previous = new Map<string, FileRecord>();
  readonly changed: { path: string; outcome: WriteOutcome | "deleted"; description: string }[] = [];

  constructor(private readonly opts: FileOpsOptions) {
    for (const r of opts.previous ?? []) {
      this.previous.set(r.path, r);
      this.records.set(r.path, { ...r });
    }
  }

  get dryRun() {
    return this.opts.dryRun;
  }

  rel(abs: string): string {
    return relative(this.opts.baseDir, abs).split(sep).join("/") || ".";
  }

  abs(rel: string): string {
    return isAbsolute(rel) ? rel : resolve(this.opts.baseDir, rel);
  }

  exists(abs: string): boolean {
    return existsSync(abs);
  }

  readText(abs: string): string | undefined {
    return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, "utf8") : undefined;
  }

  private readBuffer(abs: string): Buffer | undefined {
    return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs) : undefined;
  }

  previousRecord(abs: string): FileRecord | undefined {
    return this.previous.get(this.rel(abs));
  }

  /** True when Clayver created the file and nobody edited it since. */
  isUntouchedClayverFile(abs: string): boolean {
    const prev = this.previousRecord(abs);
    const current = this.readBuffer(abs);
    return !!prev && prev.action === "created" && !!current && sha256(current) === prev.sha256;
  }

  private record(change: FileChange, action: "created" | "modified") {
    const rel = this.rel(change.path);
    const prev = this.records.get(rel);
    this.records.set(rel, {
      path: rel,
      action: prev?.action ?? action,
      kind: change.kind,
      description: change.description,
      sha256: sha256(change.content),
      ...(mergeReversal(prev?.reversal, change.reversal) ? { reversal: mergeReversal(prev?.reversal, change.reversal) } : {}),
    });
  }

  forget(abs: string) {
    this.records.delete(this.rel(abs));
  }

  private showCreate(change: FileChange) {
    const rel = this.rel(change.path);
    const showDiff = change.showDiff ?? (typeof change.content === "string" && change.content.length < 4000);
    if (showDiff && isProbablyText(change.content)) {
      this.opts.logger.raw(truncateLines(renderDiff(rel, "", change.content.toString(), this.opts.color ?? true), 60));
    }
  }

  private diffFor(change: FileChange, existing: Buffer): string {
    const rel = this.rel(change.path);
    if (!isProbablyText(existing) || !isProbablyText(change.content)) return `  (binary file ${rel} changes)`;
    const d = renderDiff(rel, existing.toString("utf8"), change.content.toString(), this.opts.color ?? true);
    return this.opts.verbose ? d : truncateLines(d, 120);
  }

  private writeToDisk(abs: string, content: string | Buffer) {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  async write(change: FileChange): Promise<WriteOutcome> {
    const { logger, prompter, dryRun } = this.opts;
    const rel = this.rel(change.path);
    const existing = this.readBuffer(change.path);
    const next = typeof change.content === "string" ? Buffer.from(change.content) : change.content;

    if (existing && existing.equals(next)) {
      if (this.records.has(rel)) this.record(change, "modified");
      logger.detail(`${rel}: already up to date`);
      return "unchanged";
    }

    if (!existing) {
      if (dryRun) {
        logger.dryRun(`would create ${rel} (${change.description})`);
        this.showCreate(change);
      } else {
        this.writeToDisk(change.path, change.content);
        logger.success(`created ${rel}`);
      }
      this.record(change, "created");
      this.changed.push({ path: rel, outcome: "created", description: change.description });
      return "created";
    }

    const owned = this.isUntouchedClayverFile(change.path);
    logger.info(`${rel} already exists${owned ? " (created by Clayver, unchanged since)" : ""}. Proposed changes:`);
    logger.raw(this.diffFor(change, existing));
    if (dryRun) {
      logger.dryRun(`would ask before modifying ${rel}`);
      this.record(change, "modified");
      this.changed.push({ path: rel, outcome: "updated", description: change.description });
      return "updated";
    }
    const ok = await prompter.confirm({
      message: `Apply these changes to ${rel}?`,
      default: true,
      yesDefault: change.safe === true || owned,
    });
    if (!ok) {
      logger.warn(`left ${rel} unchanged`);
      this.changed.push({ path: rel, outcome: "skipped", description: change.description });
      return "skipped";
    }
    this.writeToDisk(change.path, change.content);
    logger.success(`updated ${rel}`);
    this.record(change, "modified");
    this.changed.push({ path: rel, outcome: "updated", description: change.description });
    return "updated";
  }

  /**
   * Writes a set of files (e.g. the functions folder) with one confirmation for
   * all modifications, and deletes `deletions` that Clayver created earlier.
   */
  async writeGroup(
    title: string,
    changes: FileChange[],
    deletions: string[] = [],
  ): Promise<{ applied: boolean; created: number; updated: number; deleted: number }> {
    const { logger, prompter, dryRun } = this.opts;
    const toCreate: FileChange[] = [];
    const toUpdate: { change: FileChange; existing: Buffer }[] = [];
    for (const change of changes) {
      const existing = this.readBuffer(change.path);
      if (!existing) toCreate.push(change);
      else if (!existing.equals(typeof change.content === "string" ? Buffer.from(change.content) : change.content)) {
        toUpdate.push({ change, existing });
      } else if (this.records.has(this.rel(change.path))) {
        this.record(change, "modified");
      }
    }
    const toDelete = deletions.filter((d) => existsSync(d));
    if (!toCreate.length && !toUpdate.length && !toDelete.length) {
      logger.detail(`${title}: already up to date`);
      return { applied: true, created: 0, updated: 0, deleted: 0 };
    }
    logger.info(`${title}: ${toCreate.length} new, ${toUpdate.length} changed, ${toDelete.length} removed file(s)`);
    for (const c of toCreate) logger.detail(`+ ${this.rel(c.path)}`);
    for (const d of toDelete) logger.detail(`- ${this.rel(d)}`);
    let allOwned = true;
    for (const { change, existing } of toUpdate) {
      if (!this.isUntouchedClayverFile(change.path)) allOwned = false;
      logger.raw(this.diffFor(change, existing));
    }
    for (const d of toDelete) if (!this.isUntouchedClayverFile(d)) allOwned = false;

    if (dryRun) {
      logger.dryRun(`would write ${toCreate.length + toUpdate.length} and delete ${toDelete.length} file(s) for ${title}`);
    } else if (toUpdate.length || toDelete.length) {
      const ok = await prompter.confirm({
        message: `Apply ${toUpdate.length} change(s) and ${toDelete.length} deletion(s) to ${title}?`,
        default: true,
        yesDefault: allOwned,
      });
      if (!ok) {
        logger.warn(`left ${title} unchanged`);
        return { applied: false, created: 0, updated: 0, deleted: 0 };
      }
    }
    for (const c of toCreate) {
      if (!dryRun) this.writeToDisk(c.path, c.content);
      this.record(c, "created");
    }
    for (const { change } of toUpdate) {
      if (!dryRun) this.writeToDisk(change.path, change.content);
      this.record(change, "modified");
    }
    for (const d of toDelete) {
      if (!dryRun) unlinkSync(d);
      this.forget(d);
    }
    if (!dryRun) logger.success(`${title}: wrote ${toCreate.length + toUpdate.length}, deleted ${toDelete.length} file(s)`);
    this.changed.push({ path: title, outcome: toCreate.length && !toUpdate.length ? "created" : "updated", description: title });
    return { applied: true, created: toCreate.length, updated: toUpdate.length, deleted: toDelete.length };
  }

  /**
   * Deletes a file Clayver created. Asks first when the file changed since
   * Clayver wrote it. Returns false when the file was kept.
   */
  async deleteCreated(abs: string, opts: { askAlways?: boolean } = {}): Promise<boolean> {
    const { logger, prompter, dryRun } = this.opts;
    const rel = this.rel(abs);
    if (!existsSync(abs)) {
      this.forget(abs);
      return true;
    }
    const prev = this.previous.get(rel) ?? this.records.get(rel);
    const untouched = !!prev && sha256(readFileSync(abs)) === prev.sha256;
    if (!untouched || opts.askAlways) {
      if (dryRun) {
        logger.dryRun(`would ask before deleting ${rel}${untouched ? "" : " (edited since Clayver created it)"}`);
        return true;
      }
      const ok = await prompter.confirm({
        message: untouched ? `Delete ${rel}?` : `${rel} was edited after Clayver created it. Delete it anyway?`,
        default: untouched,
        yesDefault: untouched,
      });
      if (!ok) {
        logger.warn(`kept ${rel}`);
        return false;
      }
    }
    if (dryRun) logger.dryRun(`would delete ${rel}`);
    else {
      unlinkSync(abs);
      logger.success(`deleted ${rel}`);
    }
    this.forget(abs);
    this.changed.push({ path: rel, outcome: "deleted", description: prev?.description ?? "" });
    return true;
  }

  /** Writes reverted content for a file Clayver modified (diff + confirmation), then drops its record. */
  async revert(abs: string, content: string, description: string): Promise<boolean> {
    const outcome = await this.write({ path: abs, content, kind: "firebase-config", description, safe: true });
    if (outcome === "skipped") return false;
    this.forget(abs);
    return true;
  }

  /** Removes empty directories from `dir` upwards, stopping at baseDir. */
  pruneEmptyDirs(dir: string) {
    if (this.opts.dryRun) return;
    let current = dir;
    const base = resolve(this.opts.baseDir);
    while (current.startsWith(base) && current !== base && existsSync(current)) {
      if (readdirSync(current).length) break;
      rmdirSync(current);
      current = dirname(current);
    }
  }
}
