import { FUNCTIONS_CODEBASE, FUNCTIONS_DIR, FUNCTIONS_RUNTIME } from "../constants.js";
import { deepEqual } from "../core/hash.js";
import { appendArrayItem, parseJsonc, removeArrayItem, removeProperty, replaceValue, setProperty } from "../core/jsonedit.js";
import type { JsonPath, Reversal } from "../core/manifest.js";

interface FunctionsEntry {
  source?: string;
  codebase?: string;
  [k: string]: unknown;
}

interface FirebaseJson {
  database?: { rules?: string; [k: string]: unknown } | { rules?: string; [k: string]: unknown }[];
  storage?: { rules?: string; [k: string]: unknown } | { rules?: string; [k: string]: unknown }[];
  functions?: FunctionsEntry | FunctionsEntry[];
  hosting?: unknown;
  [k: string]: unknown;
}

export interface FirebaseJsonOptions {
  functionsSource?: string;
  codebase?: string;
  /** Add a hosting entry serving the dashboard from this folder. */
  hostingPublic?: string;
  /** Leave the functions entry out (e.g. functions skipped). */
  skipFunctions?: boolean;
}

export interface FirebaseJsonPlan {
  content: string;
  /** Rules file paths actually in use (relative to firebase.json). */
  databaseRules: string;
  storageRules: string;
  reversal: Extract<Reversal, { type: "firebase-json" }>;
  warnings: string[];
  hostingAdded: boolean;
  /** firebase.json has a hosting config already; the dashboard was not added. */
  hostingConflict: boolean;
}

export function clayverFunctionsEntry(source = FUNCTIONS_DIR, codebase = FUNCTIONS_CODEBASE): FunctionsEntry {
  return {
    source,
    codebase,
    runtime: FUNCTIONS_RUNTIME,
    ignore: ["node_modules", ".git", "firebase-debug.log", "firebase-debug.*.log", "*.local"],
  };
}

function isClayverEntry(e: FunctionsEntry, source: string, codebase: string) {
  return e.codebase === codebase || e.source === source;
}

/**
 * Adds Clayver's database/storage rules paths, the `clayver` functions
 * codebase and (optionally) dashboard hosting to firebase.json. Existing
 * settings are kept; existing rules paths are reused (Clayver merges into those files).
 */
export function planFirebaseJson(existingText: string | undefined, opts: FirebaseJsonOptions = {}): FirebaseJsonPlan {
  const source = opts.functionsSource ?? FUNCTIONS_DIR;
  const codebase = opts.codebase ?? FUNCTIONS_CODEBASE;
  let text = existingText && existingText.trim() ? existingText : "{}\n";
  const json = parseJsonc<FirebaseJson>(text, "firebase.json") ?? {};
  const added: JsonPath[] = [];
  const warnings: string[] = [];
  const reversal: FirebaseJsonPlan["reversal"] = { type: "firebase-json", addedPaths: added };

  const rulesPath = (key: "database" | "storage", fallback: string): string => {
    const value = json[key];
    if (value === undefined) {
      text = setProperty(text, [], key, { rules: fallback });
      added.push([key]);
      return fallback;
    }
    if (Array.isArray(value)) {
      const first = value.find((v) => typeof v?.rules === "string");
      warnings.push(
        `firebase.json configures several ${key} targets; Clayver merges its rules into ${first?.rules ?? fallback}. ` +
          "Make sure that file is deployed to the default instance/bucket.",
      );
      return first?.rules ?? fallback;
    }
    if (typeof value.rules === "string") return value.rules;
    text = setProperty(text, [key], "rules", fallback);
    added.push([key, "rules"]);
    return fallback;
  };

  const databaseRules = rulesPath("database", "database.rules.json");
  const storageRules = rulesPath("storage", "storage.rules");

  if (!opts.skipFunctions) {
    const entry = clayverFunctionsEntry(source, codebase);
    const fns = json.functions;
    if (fns === undefined) {
      text = setProperty(text, [], "functions", [entry]);
      added.push(["functions"]);
    } else if (Array.isArray(fns)) {
      const idx = fns.findIndex((e) => isClayverEntry(e, source, codebase));
      if (idx < 0) {
        text = appendArrayItem(text, ["functions"], entry);
        reversal.functionsCodebase = codebase;
      } else if (!deepEqual({ ...fns[idx], ...entry }, fns[idx])) {
        text = replaceValue(text, ["functions", idx], { ...fns[idx], ...entry });
      }
    } else if (isClayverEntry(fns, source, codebase)) {
      if (!deepEqual({ ...fns, ...entry }, fns)) text = replaceValue(text, ["functions"], { ...fns, ...entry });
    } else {
      // A single default codebase: keep it and add Clayver's as a second codebase.
      text = replaceValue(text, ["functions"], [fns, entry]);
      reversal.functionsCodebase = codebase;
      reversal.functionsWasObject = true;
    }
  }

  let hostingAdded = false;
  let hostingConflict = false;
  if (opts.hostingPublic) {
    if (json.hosting === undefined) {
      text = setProperty(text, [], "hosting", {
        public: opts.hostingPublic,
        ignore: ["firebase.json", "**/.*", "**/node_modules/**"],
        rewrites: [{ source: "**", destination: "/index.html" }],
      });
      added.push(["hosting"]);
      hostingAdded = true;
    } else {
      const h = json.hosting as { public?: string };
      hostingConflict = !(h && !Array.isArray(h) && h.public === opts.hostingPublic);
    }
  }

  return { content: text, databaseRules, storageRules, reversal, warnings, hostingAdded, hostingConflict };
}

/** Undoes {@link planFirebaseJson} using the recorded reversal. */
export function revertFirebaseJson(text: string, reversal: Extract<Reversal, { type: "firebase-json" }>, source = FUNCTIONS_DIR): string {
  let out = text;
  const json = parseJsonc<FirebaseJson>(out, "firebase.json") ?? {};
  const codebase = reversal.functionsCodebase;
  if (codebase && Array.isArray(json.functions)) {
    const idx = json.functions.findIndex((e) => isClayverEntry(e, source, codebase));
    if (idx >= 0) {
      const rest = json.functions.filter((_, i) => i !== idx);
      if (reversal.functionsWasObject && rest.length === 1) out = replaceValue(out, ["functions"], rest[0]);
      else out = removeArrayItem(out, ["functions", idx]);
    }
  }
  // Remove added keys deepest first.
  for (const path of [...reversal.addedPaths].sort((a, b) => b.length - a.length)) {
    out = removeProperty(out, path);
  }
  return out;
}

/** True when nothing meaningful is left (`{}`), so a file Clayver created can be deleted. */
export function isEmptyJsonObject(text: string): boolean {
  try {
    const v = parseJsonc<Record<string, unknown>>(text, "file");
    return !!v && typeof v === "object" && Object.keys(v).length === 0;
  } catch {
    return false;
  }
}

export function planFirebaserc(existingText: string | undefined, projectId: string): { content: string; reversal?: Reversal; warning?: string } {
  if (!existingText || !existingText.trim()) {
    return { content: `${JSON.stringify({ projects: { default: projectId } }, null, 2)}\n` };
  }
  const json = parseJsonc<{ projects?: Record<string, string> }>(existingText, ".firebaserc") ?? {};
  if (!json.projects) {
    return {
      content: setProperty(existingText, [], "projects", { default: projectId }),
      reversal: { type: "json-remove", paths: [["projects"]] },
    };
  }
  if (!json.projects.default) {
    return {
      content: setProperty(existingText, ["projects"], "default", projectId),
      reversal: { type: "json-remove", paths: [["projects", "default"]] },
    };
  }
  if (json.projects.default !== projectId) {
    return {
      content: existingText,
      warning: `.firebaserc's default project is ${json.projects.default}; Clayver leaves it and passes --project ${projectId} explicitly.`,
    };
  }
  return { content: existingText };
}
