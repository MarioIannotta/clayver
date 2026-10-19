import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ClayverError } from "./errors.js";

export type Platform = "ios" | "android" | "flutter";
export type StepName = "prerequisites" | "app" | "firebaseProject" | "backend" | "deploy" | "push" | "example" | "dashboard";
export type StepStatus = "done" | "skipped" | "failed" | "partial";

export type JsonPath = (string | number)[];

/** How `clayver remove` undoes a change to a file that existed before Clayver. */
export type Reversal =
  | { type: "json-remove"; paths: JsonPath[] }
  | { type: "storage-rules-block" }
  | {
      type: "firebase-json";
      /** Keys Clayver added, e.g. ["database"] or ["storage", "rules"]. */
      addedPaths: JsonPath[];
      /** Codebase entry Clayver appended to `functions`. */
      functionsCodebase?: string;
      /** `functions` was a single object before Clayver turned it into an array. */
      functionsWasObject?: boolean;
    }
  | { type: "lines"; lines: string[] };

export type FileKind =
  | "firebase-config"
  | "database-rules"
  | "storage-rules"
  | "functions"
  | "functions-env"
  | "dashboard"
  | "app-config"
  | "platform-config"
  | "dependency"
  | "example";

export interface FileRecord {
  /** Relative to the directory holding clayver.json, with forward slashes. */
  path: string;
  /** `created`: the file did not exist before Clayver. `modified`: Clayver edited an existing file. */
  action: "created" | "modified";
  kind: FileKind;
  description: string;
  /** Hash of the content Clayver last wrote, to detect later hand edits. */
  sha256: string;
  reversal?: Reversal;
}

export interface BackendRecord {
  firebaseDir: string;
  databaseRules: string;
  storageRules: string;
  functionsDir: string;
  functionsCodebase: string;
  functionNames: string[];
  databaseURL?: string;
  bootstrapAdmins: string[];
  /** Hash of the `rules.clayver` subtree Clayver installed. */
  databaseRulesSubtreeHash?: string;
  /** Hash of the managed block in storage.rules. */
  storageRulesBlockHash?: string;
  hostingPublic?: string;
  assetsVersion?: string;
  deployedAt?: string;
}

/** The agent dashboard folder `init` generated (see `clayver dashboard`). */
export interface DashboardRecord {
  /** The dashboard folder, relative to the directory holding clayver.json. */
  dir: string;
  /** Firebase web app the dashboard uses. Not deleted by `remove`. */
  webAppId?: string;
  /** Last `clayver dashboard deploy`. */
  hosting?: { site?: string; url: string; deployedAt?: string };
}

export interface ClayverManifest {
  manifestVersion: 1;
  cliVersion: string;
  createdAt: string;
  updatedAt: string;
  platform: Platform | null;
  firebaseProjectId: string | null;
  workspace: string;
  region: string;
  app: { bundleId?: string; applicationId?: string; firebaseAppId?: string; configFile?: string };
  backend?: BackendRecord;
  dashboard?: DashboardRecord;
  steps: Partial<Record<StepName, StepStatus>>;
  files: FileRecord[];
  notes?: string[];
}

export const MANIFEST_FILE = "clayver.json";

export function manifestPath(appDir: string): string {
  return join(appDir, MANIFEST_FILE);
}

export function parseManifest(text: string, source = MANIFEST_FILE): ClayverManifest {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new ClayverError(`${source} is not valid JSON: ${(e as Error).message}`);
  }
  const m = data as Partial<ClayverManifest>;
  if (!m || typeof m !== "object" || m.manifestVersion !== 1 || !Array.isArray(m.files)) {
    throw new ClayverError(`${source} is not a Clayver manifest (manifestVersion 1).`);
  }
  for (const f of m.files) {
    if (typeof f.path !== "string" || (f.action !== "created" && f.action !== "modified") || typeof f.sha256 !== "string") {
      throw new ClayverError(`${source} has an invalid file record: ${JSON.stringify(f)}`);
    }
  }
  return m as ClayverManifest;
}

export function serializeManifest(m: ClayverManifest): string {
  return `${JSON.stringify(m, null, 2)}\n`;
}

export function readManifest(appDir: string): ClayverManifest | undefined {
  const p = manifestPath(appDir);
  if (!existsSync(p)) return undefined;
  return parseManifest(readFileSync(p, "utf8"), p);
}

export function requireManifest(appDir: string): ClayverManifest {
  const m = readManifest(appDir);
  if (!m) {
    throw new ClayverError(
      `No ${MANIFEST_FILE} found in ${appDir}.`,
      "Run `npx clayver init` first, or pass --dir <your app directory>.",
    );
  }
  return m;
}

/** Combines the reversal of an earlier run with a new one for the same file. */
export function mergeReversal(prev: Reversal | undefined, next: Reversal | undefined): Reversal | undefined {
  if (!prev) return next;
  if (!next) return prev;
  if (prev.type !== next.type) return prev;
  const uniqPaths = (a: JsonPath[], b: JsonPath[]) => {
    const seen = new Set(a.map((p) => JSON.stringify(p)));
    return [...a, ...b.filter((p) => !seen.has(JSON.stringify(p)))];
  };
  switch (prev.type) {
    case "json-remove":
      return { type: "json-remove", paths: uniqPaths(prev.paths, (next as typeof prev).paths) };
    case "firebase-json": {
      const n = next as typeof prev;
      return {
        type: "firebase-json",
        addedPaths: uniqPaths(prev.addedPaths, n.addedPaths),
        functionsCodebase: prev.functionsCodebase ?? n.functionsCodebase,
        functionsWasObject: prev.functionsWasObject ?? n.functionsWasObject,
      };
    }
    case "lines": {
      const n = next as typeof prev;
      return { type: "lines", lines: [...prev.lines, ...n.lines.filter((l) => !prev.lines.includes(l))] };
    }
    default:
      return prev;
  }
}
