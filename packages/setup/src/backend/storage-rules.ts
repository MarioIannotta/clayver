import { ClayverError } from "../core/errors.js";
import { sha256 } from "../core/hash.js";

export const STORAGE_BEGIN = "// >>> clayver: managed by the clayver CLI. `npx clayver update` replaces this block; `npx clayver remove` deletes it.";
export const STORAGE_END = "// <<< clayver";

const BUCKET_BLOCK = /match\s+\/b\/\{\s*\w+\s*\}\/o\s*\{/;

/** Index of the `}` matching the `{` at `open`, skipping strings and comments. */
export function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "/") {
      const eol = text.indexOf("\n", i);
      i = eol < 0 ? text.length : eol;
    } else if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (c === "'" || c === '"') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
    } else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function bucketBlock(text: string): { open: number; close: number } | undefined {
  const m = BUCKET_BLOCK.exec(text);
  if (!m) return undefined;
  const open = m.index + m[0].length - 1;
  const close = matchingBrace(text, open);
  return close < 0 ? undefined : { open, close };
}

function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)?.[0].length ?? 0);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min));
}

/**
 * The body of Clayver's `match /b/{bucket}/o { ... }` block, with helper
 * functions renamed to `clayver_*` so they cannot collide with the host app's.
 */
export function clayverStorageBody(assetText: string): string {
  const block = bucketBlock(assetText);
  if (!block) throw new ClayverError("The bundled storage.rules has no `match /b/{bucket}/o` block.");
  let body = assetText.slice(block.open + 1, block.close);
  // Drop comments that only make sense in the standalone file.
  body = body.replace(/^[ \t]*\/\/ (Everything else in the bucket|When merging into an existing).*\n/gm, "");
  const names = [...body.matchAll(/function\s+([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1] as string);
  for (const name of names) {
    if (name.startsWith("clayver")) continue;
    body = body.replace(new RegExp(`\\b${name}\\s*\\(`, "g"), `clayver_${name}(`);
  }
  const lines = body.split("\n");
  while (lines.length && !lines[0]?.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]?.trim()) lines.pop();
  return dedent(lines)
    .map((l) => (l.trim() ? l.replace(/[ \t]+$/, "") : ""))
    .join("\n");
}

function managedBlock(body: string, indent: string): string {
  const inner = body
    .split("\n")
    .map((l) => (l.trim() ? indent + l : ""))
    .join("\n");
  return `${indent}${STORAGE_BEGIN}\n${inner}\n${indent}${STORAGE_END}`;
}

function findManaged(text: string): { start: number; end: number; body: string } | undefined {
  const b = text.indexOf("// >>> clayver");
  if (b < 0) return undefined;
  const e = text.indexOf(STORAGE_END, b);
  if (e < 0) throw new ClayverError("storage.rules has a `// >>> clayver` marker without the matching `// <<< clayver`.");
  const start = text.lastIndexOf("\n", b) + 1;
  const endLine = text.indexOf("\n", e);
  const end = endLine < 0 ? text.length : endLine + 1;
  const bodyStart = text.indexOf("\n", b) + 1;
  const bodyEnd = text.lastIndexOf("\n", e);
  const body = dedent(text.slice(bodyStart, bodyEnd).split("\n"))
    .map((l) => (l.trim() ? l.replace(/[ \t]+$/, "") : ""))
    .join("\n")
    .trim();
  return { start, end, body };
}

export function managedBlockHash(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = findManaged(text);
  return m ? sha256(m.body) : undefined;
}

export interface StorageMergeResult {
  status: "created" | "added" | "unchanged" | "updated" | "conflict" | "manual";
  content: string;
  warnings: string[];
  conflict?: string;
  blockHash: string;
}

function outsideWarnings(text: string): string[] {
  const managed = findManaged(text);
  const outside = managed ? text.slice(0, managed.start) + text.slice(managed.end) : text;
  const warnings: string[] = [];
  if (!/rules_version\s*=\s*['"]2['"]/.test(outside)) {
    warnings.push("storage.rules does not declare rules_version = '2'. Clayver's rules are written for version 2.");
  }
  if (/match\s+\/\{\s*\w+\s*=\s*\*\*\s*\}/.test(outside)) {
    warnings.push(
      "storage.rules has a recursive wildcard match (`{path=**}`). Storage rules are OR-ed, so if it allows access, " +
        "it also applies to clayver/ attachments. Make sure it does not allow reads or writes broader than intended.",
    );
  }
  return warnings;
}

/**
 * Merges Clayver's attachment rules into storage.rules inside a marked block,
 * leaving everything else in the file untouched.
 */
export function mergeStorageRules(existingText: string | undefined, assetText: string, previousBlockHash?: string): StorageMergeResult {
  const body = clayverStorageBody(assetText);
  const blockHash = sha256(body.trim());
  const source = existingText === undefined || existingText.trim() === "" ? undefined : existingText;
  const base = source ?? assetText;
  const managed = findManaged(base);
  const block = bucketBlock(base);

  if (managed) {
    const indent = /^[ \t]*/.exec(base.slice(managed.start))?.[0] ?? "    ";
    const content = base.slice(0, managed.start) + managedBlock(body, indent) + "\n" + base.slice(managed.end);
    const warnings = outsideWarnings(content);
    if (sha256(managed.body) === blockHash) return { status: "unchanged", content: base, warnings, blockHash };
    if (previousBlockHash && sha256(managed.body) === previousBlockHash) return { status: "updated", content, warnings, blockHash };
    return {
      status: "conflict",
      content,
      warnings,
      blockHash,
      conflict: "The Clayver block in storage.rules was edited by hand; replacing it discards those edits.",
    };
  }
  if (!block) {
    return {
      status: "manual",
      content: base,
      blockHash,
      warnings: [],
      conflict:
        "storage.rules has no `match /b/{bucket}/o { ... }` block, so Clayver cannot merge into it automatically. " +
        "Paste the Clayver block (printed below) inside your bucket match block.",
    };
  }
  const closeLineStart = base.lastIndexOf("\n", block.close) + 1;
  const closeIndent = /^[ \t]*/.exec(base.slice(closeLineStart))?.[0] ?? "  ";
  const indent = closeIndent + "  ";
  if (!source) {
    // New file: Clayver's own rules file, with the bucket block's body marked as managed.
    const content = `${base.slice(0, block.open + 1)}\n${managedBlock(body, indent)}\n${base.slice(closeLineStart)}`;
    return { status: "created", content, warnings: [], blockHash };
  }
  const before = base.slice(0, closeLineStart);
  const sep = /\{\s*$/.test(before) ? "" : "\n";
  const content = `${before}${sep}${managedBlock(body, indent)}\n${base.slice(closeLineStart)}`;
  {
    for (const name of [...body.matchAll(/function\s+(\w+)\s*\(/g)].map((m) => m[1])) {
      if (new RegExp(`function\\s+${name}\\s*\\(`).test(source)) {
        return { status: "conflict", content, blockHash, warnings: [], conflict: `storage.rules already defines a function named ${name}.` };
      }
    }
  }
  return { status: "added", content, warnings: outsideWarnings(content), blockHash };
}

/** Deletes the managed block. */
export function removeStorageRules(text: string): string {
  const managed = findManaged(text);
  if (!managed) return text;
  let before = text.slice(0, managed.start);
  // Remove the blank separator line Clayver added before the block.
  if (/\n[ \t]*\n$/.test(before)) before = before.replace(/[ \t]*\n$/, "");
  return before + text.slice(managed.end);
}

/** The block a developer can paste by hand when automatic merging is impossible. */
export function manualStorageSnippet(assetText: string): string {
  return managedBlock(clayverStorageBody(assetText), "    ");
}
