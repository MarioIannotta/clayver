const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function formatTime(ms: number | undefined): string {
  return typeof ms === "number" ? timeFormat.format(ms) : "";
}

export function formatFull(ms: number | undefined): string {
  return typeof ms === "number" ? fullFormat.format(ms) : "";
}

/** Compact list timestamp: "now", "5m", "3h", "Mar 4". */
export function formatShort(ms: number | undefined, now = Date.now()): string {
  if (typeof ms !== "number") return "";
  const diff = Math.max(0, now - ms);
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return dateFormat.format(ms);
}

/** Day label for message separators. */
export function formatDay(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(d);
}

export function initials(label: string): string {
  const parts = label.trim().split(/[\s@._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "");
  return letters.toUpperCase();
}
