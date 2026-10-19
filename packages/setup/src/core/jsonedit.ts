import { findNodeAtLocation, parse, parseTree, printParseErrorCode, type Node, type ParseError } from "jsonc-parser";
import { ClayverError } from "./errors.js";
import type { JsonPath } from "./manifest.js";

/**
 * Minimal, formatting-preserving JSON(C) edits: insert, replace or remove one
 * property while leaving every other byte of the file (comments, indentation,
 * key order) untouched. Inserting then removing a property restores the
 * original text exactly.
 */

export function parseJsonc<T = unknown>(text: string, label: string): T {
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false }) as T;
  if (errors.length) {
    const e = errors[0] as ParseError;
    const line = text.slice(0, e.offset).split("\n").length;
    throw new ClayverError(`${label} is not valid JSON (${printParseErrorCode(e.error)} at line ${line}).`, `Fix ${label} and run the command again.`);
  }
  return value;
}

function tree(text: string): Node {
  const t = parseTree(text, [], { allowTrailingComma: true });
  if (!t) throw new ClayverError("Empty JSON document.");
  return t;
}

export function detectIndentUnit(text: string): string {
  const m = /\n([ \t]+)\S/.exec(text);
  if (!m) return "  ";
  const ws = m[1] as string;
  return ws.startsWith("\t") ? "\t" : " ".repeat(Math.min(ws.length, 8));
}

function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function lineIndentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
}

function stringifyAt(value: unknown, baseIndent: string, unit: string, eol: string): string {
  return JSON.stringify(value, null, unit).replace(/\n/g, eol + baseIndent);
}

export function hasPath(text: string, path: JsonPath): boolean {
  return !!findNodeAtLocation(tree(text), path);
}

/** Sets `parentPath.key = value`, inserting or replacing in place. The parent must be an object. */
export function setProperty(text: string, parentPath: JsonPath, key: string, value: unknown): string {
  const root = tree(text);
  const parent = parentPath.length ? findNodeAtLocation(root, parentPath) : root;
  if (!parent || parent.type !== "object") {
    throw new ClayverError(`Cannot add "${key}": ${parentPath.join(".") || "the document"} is not an object.`);
  }
  const unit = detectIndentUnit(text);
  const eol = eolOf(text);
  const existing = findNodeAtLocation(root, [...parentPath, key]);
  if (existing) {
    const indent = lineIndentAt(text, existing.parent?.offset ?? existing.offset);
    const replacement = stringifyAt(value, indent, unit, eol);
    return text.slice(0, existing.offset) + replacement + text.slice(existing.offset + existing.length);
  }
  const props = parent.children ?? [];
  const last = props[props.length - 1];
  if (last) {
    const indent = lineIndentAt(text, last.offset);
    const insert = `,${eol}${indent}${JSON.stringify(key)}: ${stringifyAt(value, indent, unit, eol)}`;
    const at = last.offset + last.length;
    return text.slice(0, at) + insert + text.slice(at);
  }
  const parentIndent = lineIndentAt(text, parent.offset);
  const indent = parentIndent + unit;
  const inner = `${eol}${indent}${JSON.stringify(key)}: ${stringifyAt(value, indent, unit, eol)}${eol}${parentIndent}`;
  return text.slice(0, parent.offset + 1) + inner + text.slice(parent.offset + parent.length - 1);
}

/** Removes the property at `path` (no-op when absent). */
export function removeProperty(text: string, path: JsonPath): string {
  const root = tree(text);
  const valueNode = findNodeAtLocation(root, path);
  const prop = valueNode?.parent;
  if (!valueNode || !prop || prop.type !== "property") return text;
  const obj = prop.parent as Node;
  const siblings = obj.children ?? [];
  const idx = siblings.indexOf(prop);
  let start: number;
  let end: number;
  if (idx > 0) {
    const prev = siblings[idx - 1] as Node;
    start = prev.offset + prev.length;
    end = prop.offset + prop.length;
  } else if (siblings.length > 1) {
    start = prop.offset;
    end = (siblings[1] as Node).offset;
  } else {
    start = obj.offset + 1;
    end = obj.offset + obj.length - 1;
  }
  return text.slice(0, start) + text.slice(end);
}

/** Replaces the value at `path` (which must exist). */
export function replaceValue(text: string, path: JsonPath, value: unknown): string {
  const node = findNodeAtLocation(tree(text), path);
  if (!node) throw new ClayverError(`Cannot replace ${path.join(".")}: not found.`);
  const indent = lineIndentAt(text, node.parent?.offset ?? node.offset);
  return text.slice(0, node.offset) + stringifyAt(value, indent, detectIndentUnit(text), eolOf(text)) + text.slice(node.offset + node.length);
}

/** Appends an item to the array at `path`. */
export function appendArrayItem(text: string, path: JsonPath, value: unknown): string {
  const node = findNodeAtLocation(tree(text), path);
  if (!node || node.type !== "array") throw new ClayverError(`${path.join(".")} is not an array.`);
  const unit = detectIndentUnit(text);
  const eol = eolOf(text);
  const items = node.children ?? [];
  const last = items[items.length - 1];
  if (last) {
    const indent = lineIndentAt(text, last.offset);
    const at = last.offset + last.length;
    return `${text.slice(0, at)},${eol}${indent}${stringifyAt(value, indent, unit, eol)}${text.slice(at)}`;
  }
  const parentIndent = lineIndentAt(text, node.offset);
  const indent = parentIndent + unit;
  return `${text.slice(0, node.offset + 1)}${eol}${indent}${stringifyAt(value, indent, unit, eol)}${eol}${parentIndent}${text.slice(node.offset + node.length - 1)}`;
}

/** Removes the array item at `path` (the last segment is the index). */
export function removeArrayItem(text: string, path: JsonPath): string {
  const node = findNodeAtLocation(tree(text), path);
  const arr = node?.parent;
  if (!node || !arr || arr.type !== "array") return text;
  const items = arr.children ?? [];
  const idx = items.indexOf(node);
  let start: number;
  let end: number;
  if (idx > 0) {
    const prev = items[idx - 1] as Node;
    start = prev.offset + prev.length;
    end = node.offset + node.length;
  } else if (items.length > 1) {
    start = node.offset;
    end = (items[1] as Node).offset;
  } else {
    start = arr.offset + 1;
    end = arr.offset + arr.length - 1;
  }
  return text.slice(0, start) + text.slice(end);
}
