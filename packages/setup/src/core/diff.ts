import { createTwoFilesPatch } from "diff";
import pc from "picocolors";

export function isProbablyText(content: string | Buffer): boolean {
  if (typeof content === "string") return true;
  return !content.subarray(0, 8000).includes(0);
}

/** Unified diff, colored for the terminal. Empty string when equal. */
export function renderDiff(label: string, before: string, after: string, color = true): string {
  if (before === after) return "";
  const patch = createTwoFilesPatch(`a/${label}`, `b/${label}`, before, after, undefined, undefined, { context: 3 });
  const lines = patch.split("\n").filter((l) => !l.startsWith("====="));
  if (!color) return lines.join("\n");
  return lines
    .map((l) => {
      if (l.startsWith("+++") || l.startsWith("---")) return pc.bold(l);
      if (l.startsWith("+")) return pc.green(l);
      if (l.startsWith("-")) return pc.red(l);
      if (l.startsWith("@@")) return pc.cyan(l);
      return l;
    })
    .join("\n");
}

/** Truncates long diffs (e.g. a whole rules file being created). */
export function truncateLines(text: string, max: number): string {
  const lines = text.split("\n");
  if (lines.length <= max) return text;
  return `${lines.slice(0, max).join("\n")}\n${pc.dim(`… ${lines.length - max} more line(s)`)}`;
}
