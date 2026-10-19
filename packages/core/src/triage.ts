/**
 * The workspace's priority and status lists (`triageOptions/{kind}`), editable by
 * agents. Until a list is saved, the defaults below apply.
 */
import { onValue, ref, set } from "firebase/database";
import type { ClayverClient } from "./client.js";
import { ClayverError, toClayverError } from "./errors.js";
import { TAG_COLOR_PATTERN, tagSlug } from "./tags.js";
import type { TriageKind, TriageOption, TriageOptionRecord, Unsubscribe } from "./types.js";

export const DEFAULT_PRIORITIES: readonly TriageOption[] = [
  { id: "high", name: "High", color: "#DC2626", order: 0 },
  { id: "medium", name: "Medium", color: "#D97706", order: 1 },
  { id: "low", name: "Low", color: "#64748B", order: 2 },
];

export const DEFAULT_STAGES: readonly TriageOption[] = [
  { id: "todo", name: "To do", color: "#2563EB", order: 0 },
  { id: "in_progress", name: "In progress", color: "#7C3AED", order: 1 },
  { id: "on_hold", name: "On hold", color: "#64748B", order: 2 },
];

export const DEFAULT_TRIAGE_OPTIONS: Readonly<Record<TriageKind, readonly TriageOption[]>> = {
  priority: DEFAULT_PRIORITIES,
  stage: DEFAULT_STAGES,
};

export const MAX_TRIAGE_OPTIONS = 10;
export const MAX_TRIAGE_NAME_LENGTH = 40;
export const TRIAGE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export interface TriageOptions {
  priority: TriageOption[];
  stage: TriageOption[];
}

function toList(value: Record<string, Partial<TriageOptionRecord>> | null | undefined, kind: TriageKind): TriageOption[] {
  if (!value) return [...DEFAULT_TRIAGE_OPTIONS[kind]];
  return Object.entries(value)
    .filter(([id, o]) => TRIAGE_ID_PATTERN.test(id) && typeof o?.name === "string")
    .map(([id, o]) => ({
      id,
      name: o.name!,
      color: typeof o.color === "string" && TAG_COLOR_PATTERN.test(o.color) ? o.color : "#64748B",
      order: typeof o.order === "number" ? o.order : 0,
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** Parses `triageOptions/` (`null` lists fall back to the defaults). */
export function snapshotToTriageOptions(
  value: Partial<Record<TriageKind, Record<string, Partial<TriageOptionRecord>>>> | null | undefined,
): TriageOptions {
  return { priority: toList(value?.priority, "priority"), stage: toList(value?.stage, "stage") };
}

/** Live priority and status lists, with the defaults for any list never saved. */
export function subscribeTriageOptions(
  client: ClayverClient,
  onChange: (options: TriageOptions) => void,
  onError?: (err: ClayverError) => void,
): Unsubscribe {
  return onValue(
    ref(client.db, client.paths.triageOptions()),
    (snap) => onChange(snapshotToTriageOptions(snap.val())),
    (err) => onError?.(toClayverError(err)),
  );
}

/** A new option id for `name`, unique among `taken`. */
export function triageOptionId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = (tagSlug(name) ?? "option").slice(0, 32);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Checks a list before saving; throws `invalid-argument` with a readable message. */
export function validateTriageOptions(options: TriageOption[]): TriageOption[] {
  if (options.length === 0) throw new ClayverError("invalid-argument", "Keep at least one option.");
  if (options.length > MAX_TRIAGE_OPTIONS) {
    throw new ClayverError("invalid-argument", `Use at most ${MAX_TRIAGE_OPTIONS} options.`);
  }
  const names = new Set<string>();
  return options.map((o, i) => {
    const name = o.name.trim().replace(/\s+/g, " ");
    if (!name || name.length > MAX_TRIAGE_NAME_LENGTH) {
      throw new ClayverError("invalid-argument", `Option names are 1 to ${MAX_TRIAGE_NAME_LENGTH} characters.`);
    }
    if (names.has(name.toLowerCase())) throw new ClayverError("invalid-argument", `“${name}” is listed twice.`);
    names.add(name.toLowerCase());
    if (!TRIAGE_ID_PATTERN.test(o.id)) throw new ClayverError("invalid-argument", `Invalid option id “${o.id}”.`);
    if (!TAG_COLOR_PATTERN.test(o.color)) throw new ClayverError("invalid-argument", `Invalid color “${o.color}”.`);
    return { id: o.id, name, color: o.color.toUpperCase(), order: i };
  });
}

/**
 * Saves the whole priority or status list in the given order. Conversations set
 * to an option that is no longer in the list simply show no value.
 */
export async function saveTriageOptions(client: ClayverClient, kind: TriageKind, options: TriageOption[]): Promise<void> {
  const valid = validateTriageOptions(options);
  const value: Record<string, TriageOptionRecord> = {};
  for (const o of valid) value[o.id] = { name: o.name, color: o.color, order: o.order };
  try {
    await set(ref(client.db, `${client.paths.triageOptions()}/${kind}`), value);
  } catch (err) {
    throw toClayverError(err);
  }
}

/** Goes back to the default list (removes the saved one). */
export async function resetTriageOptions(client: ClayverClient, kind: TriageKind): Promise<void> {
  try {
    await set(ref(client.db, `${client.paths.triageOptions()}/${kind}`), null);
  } catch (err) {
    throw toClayverError(err);
  }
}
