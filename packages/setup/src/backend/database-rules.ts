import { DATABASE_RULES_KEY } from "../constants.js";
import { ClayverError } from "../core/errors.js";
import { deepEqual, jsonHash } from "../core/hash.js";
import { parseJsonc, removeProperty, setProperty } from "../core/jsonedit.js";

export type RulesMergeStatus =
  /** No rules file existed: Clayver's file is used as is. */
  | "created"
  /** Existing rules preserved, `clayver` subtree added. */
  | "added"
  /** The installed subtree already matches. */
  | "unchanged"
  /** The subtree Clayver installed earlier (unedited) is replaced by the new version. */
  | "updated"
  /** A `clayver` subtree exists that Clayver did not install or that was edited. */
  | "conflict";

export interface RulesMergeResult {
  status: RulesMergeStatus;
  /** The merged file content. For `conflict`, the content if the user accepts the replacement. */
  content: string;
  warnings: string[];
  conflict?: string;
  /** Hash of the subtree in `content`, recorded in clayver.json. */
  subtreeHash: string;
}

interface RulesFile {
  rules?: Record<string, unknown>;
}

export function clayverSubtree(assetText: string): unknown {
  const asset = parseJsonc<RulesFile>(assetText, "bundled database.rules.json");
  const subtree = asset.rules?.[DATABASE_RULES_KEY];
  if (!subtree) throw new ClayverError(`The bundled database.rules.json has no "rules.${DATABASE_RULES_KEY}" subtree.`);
  return subtree;
}

/** Root-level rules cascade into every child, so they can widen access to clayver/. */
function cascadeWarnings(rules: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  for (const key of [".read", ".write"]) {
    const v = rules[key];
    if (v === undefined || v === false || v === "false") continue;
    warnings.push(
      `The root rule "${key}": ${JSON.stringify(v)} cascades into clayver/ — Realtime Database rules cannot take away ` +
        "access granted by a parent, so it can expose or allow writes to support conversations. Consider moving it into " +
        "the specific paths that need it.",
    );
  }
  return warnings;
}

/**
 * Merges Clayver's `rules.clayver` subtree into an existing database.rules.json.
 * Every other rule is preserved byte for byte.
 *
 * @param previousSubtreeHash hash recorded in clayver.json when Clayver last
 *   installed the subtree; lets `update` replace it without a conflict.
 */
export function mergeDatabaseRules(
  existingText: string | undefined,
  assetText: string,
  previousSubtreeHash?: string,
): RulesMergeResult {
  const subtree = clayverSubtree(assetText);
  const subtreeHash = jsonHash(subtree);
  if (existingText === undefined || existingText.trim() === "") {
    return { status: "created", content: assetText, warnings: [], subtreeHash };
  }
  const existing = parseJsonc<RulesFile>(existingText, "database.rules.json");
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    throw new ClayverError("database.rules.json must contain a JSON object.");
  }
  if (!existing.rules) {
    const content = setProperty(existingText, [], "rules", { [DATABASE_RULES_KEY]: subtree });
    return { status: "added", content, warnings: [], subtreeHash };
  }
  if (typeof existing.rules !== "object" || Array.isArray(existing.rules)) {
    throw new ClayverError('"rules" in database.rules.json must be an object.');
  }
  const warnings = cascadeWarnings(existing.rules);
  const current = existing.rules[DATABASE_RULES_KEY];
  const content = setProperty(existingText, ["rules"], DATABASE_RULES_KEY, subtree);
  if (current === undefined) return { status: "added", content, warnings, subtreeHash };
  if (deepEqual(current, subtree)) return { status: "unchanged", content: existingText, warnings, subtreeHash };
  if (previousSubtreeHash && jsonHash(current) === previousSubtreeHash) {
    return { status: "updated", content, warnings, subtreeHash };
  }
  return {
    status: "conflict",
    content,
    warnings,
    subtreeHash,
    conflict: previousSubtreeHash
      ? `rules.${DATABASE_RULES_KEY} was edited after Clayver installed it; replacing it discards those edits.`
      : `rules.${DATABASE_RULES_KEY} already exists and was not installed by this Clayver setup; replacing it discards its current content.`,
  };
}

/** Removes Clayver's subtree, leaving the rest of the file as it was. */
export function removeDatabaseRules(text: string): string {
  return removeProperty(text, ["rules", DATABASE_RULES_KEY]);
}

export function currentSubtreeHash(text: string | undefined): string | undefined {
  if (!text) return undefined;
  try {
    const sub = parseJsonc<RulesFile>(text, "database.rules.json").rules?.[DATABASE_RULES_KEY];
    return sub === undefined ? undefined : jsonHash(sub);
  } catch {
    return undefined;
  }
}
