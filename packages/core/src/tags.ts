/**
 * Workspace tags: the catalog (`tags/{tagId}`), the tags of each conversation
 * (`conversationTags/{conversationId}/{tagId}`) and the inbox filtered by tag
 * (`tagIndex/{tagId}/{conversationId}` = the conversation's statusOrder).
 */
import {
  endAt,
  get,
  limitToLast,
  onValue,
  orderByValue,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
  startAt,
  update,
} from "firebase/database";
import type { ClayverClient } from "./client.js";
import { ClayverError, toClayverError } from "./errors.js";
import { compareConversationsByRecency, statusOrderRange } from "./statusOrder.js";
import {
  DEFAULT_CONVERSATION_PAGE_SIZE,
  type ConversationListOptions,
  type ConversationListState,
  type ConversationListSubscription,
} from "./conversations.js";
import type { Conversation, ConversationRecord, Tag, TagRecord, Unsubscribe } from "./types.js";

export const MAX_TAG_NAME_LENGTH = 40;
export const MAX_TAG_ID_LENGTH = 40;
export const TAG_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const TAG_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Colors offered for new tags, in schema order. */
export const TAG_PALETTE = [
  "#2563EB",
  "#7C3AED",
  "#D97706",
  "#64748B",
  "#DC2626",
  "#EA580C",
  "#0D9488",
  "#16A34A",
  "#0891B2",
  "#DB2777",
] as const;

const RANDOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function isValidTagId(id: string): boolean {
  return TAG_ID_PATTERN.test(id);
}

export function isValidTagColor(color: string): boolean {
  return TAG_COLOR_PATTERN.test(color);
}

/**
 * The slug of a tag name: lowercase, NFKD without combining marks, every run
 * outside `[a-z0-9]` replaced by `-`, `-` trimmed, cut to 40 characters, then
 * a trailing `-` trimmed again. Letters without a decomposition (ß, ø) become
 * separators ("Straße" -> "stra-e"). `null` when nothing usable is left (for example only emoji).
 */
export function tagSlug(name: string): string | null {
  const decomposed = name.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "");
  const slug = decomposed
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TAG_ID_LENGTH)
    .replace(/-+$/, "");
  return isValidTagId(slug) ? slug : null;
}

/** The id a new tag named `name` gets: its slug, else `tag-` plus 8 random `[a-z0-9]`. */
export function tagIdForName(name: string, random: () => number = Math.random): string {
  const slug = tagSlug(name);
  if (slug) return slug;
  let suffix = "";
  for (let i = 0; i < 8; i++) suffix += RANDOM_ALPHABET[Math.floor(random() * RANDOM_ALPHABET.length)];
  return `tag-${suffix}`;
}

/** The palette color for a slug: the sum of its UTF-16 code units modulo 10. */
export function defaultTagColor(slug: string): string {
  let sum = 0;
  for (let i = 0; i < slug.length; i++) sum += slug.charCodeAt(i);
  return TAG_PALETTE[sum % TAG_PALETTE.length]!;
}

/** Trims a tag name and checks the 1-40 characters rule. */
export function normalizeTagName(name: string): string {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > MAX_TAG_NAME_LENGTH) {
    throw new ClayverError("invalid-argument", `A tag name must be 1-${MAX_TAG_NAME_LENGTH} characters.`);
  }
  return trimmed;
}

function assertTagColor(color: string): string {
  if (!isValidTagColor(color)) throw new ClayverError("invalid-argument", "A tag color must be #rrggbb.");
  return color;
}

/** Sorts tags by name (case-insensitive), then id. */
export function compareTags(a: Pick<Tag, "id" | "name">, b: Pick<Tag, "id" | "name">): number {
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Converts the `tags` node into a sorted list; entries without a name are skipped, a bad color falls back to the default. */
export function snapshotToTags(value: Record<string, Partial<TagRecord>> | null | undefined): Tag[] {
  if (!value) return [];
  const out: Tag[] = [];
  for (const [id, t] of Object.entries(value)) {
    if (!t || typeof t !== "object" || typeof t.name !== "string" || !t.name.trim()) continue;
    const color = typeof t.color === "string" && isValidTagColor(t.color) ? t.color : defaultTagColor(id);
    out.push({ ...t, id, name: t.name, color } as Tag);
  }
  return out.sort(compareTags);
}

/** The tag ids of `conversationTags/{conversationId}` whose value is `true`, sorted. */
export function snapshotToTagIds(value: Record<string, unknown> | null | undefined): string[] {
  if (!value) return [];
  return Object.entries(value)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .sort();
}

/** Tags whose name or id contains `search` (case- and accent-insensitive); name-prefix matches first. */
export function filterTags<T extends Pick<Tag, "id" | "name">>(tags: T[], search: string): T[] {
  const q = foldForSearch(search.trim());
  if (!q) return tags;
  const starts: T[] = [];
  const contains: T[] = [];
  for (const t of tags) {
    const name = foldForSearch(t.name);
    if (name.startsWith(q)) starts.push(t);
    else if (name.includes(q) || t.id.includes(q)) contains.push(t);
  }
  return [...starts, ...contains];
}

/** The tag whose name equals `name` (case- and accent-insensitive) or whose id is its slug. */
export function findTagByName<T extends Pick<Tag, "id" | "name">>(tags: T[], name: string): T | undefined {
  const q = foldForSearch(name.trim());
  if (!q) return undefined;
  const slug = tagSlug(name);
  return tags.find((t) => foldForSearch(t.name) === q) ?? (slug ? tags.find((t) => t.id === slug) : undefined);
}

/** Lowercase without diacritics, for searching. */
export function foldForSearch(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "");
}

/** The tags for `ids`, in catalog order; ids missing from the catalog are dropped. */
export function tagsForIds(catalog: Tag[], ids: Iterable<string>): Tag[] {
  const wanted = new Set(ids);
  return catalog.filter((t) => wanted.has(t.id));
}

/** Live tag catalog, sorted by name. */
export function subscribeTags(
  client: ClayverClient,
  callback: (tags: Tag[]) => void,
  onError?: (err: ClayverError) => void,
): Unsubscribe {
  return onValue(
    ref(client.db, client.paths.tags()),
    (snap) => callback(snapshotToTags(snap.val() as Record<string, TagRecord> | null)),
    (err) => onError?.(toClayverError(err)),
  );
}

export interface CreateTagInput {
  name: string;
  /** `#rrggbb`; defaults to the palette color picked by the slug. */
  color?: string;
}

export interface CreateTagResult {
  tag: Tag;
  /** False when a tag with the same slug already existed and was returned instead. */
  created: boolean;
}

/**
 * Creates a tag under the slug of its name. When the slug already exists the
 * existing tag is returned unchanged (`created: false`).
 */
export async function createTag(client: ClayverClient, input: CreateTagInput): Promise<CreateTagResult> {
  const uid = client.auth.currentUser?.uid;
  if (!uid) throw new ClayverError("unauthenticated", "You are signed out.");
  const name = normalizeTagName(input.name);
  const id = tagIdForName(name);
  const color = input.color ? assertTagColor(input.color) : defaultTagColor(id);
  const tagRef = ref(client.db, client.paths.tag(id));
  const readExisting = async (): Promise<Tag | null> => {
    const snap = await get(tagRef);
    return snapshotToTags(snap.exists() ? { [id]: snap.val() as TagRecord } : null)[0] ?? null;
  };
  try {
    const existing = await readExisting();
    if (existing) return { tag: existing, created: false };
    try {
      await set(tagRef, { name, color, createdAt: serverTimestamp(), createdBy: uid });
    } catch (err) {
      // Someone created the same slug in between: the rules reject our createdAt, return theirs.
      const raced = await readExisting();
      if (raced) return { tag: raced, created: false };
      throw err;
    }
    return { tag: { id, name, color, createdBy: uid }, created: true };
  } catch (err) {
    throw toClayverError(err);
  }
}

/** Renames and/or recolors a tag. The id never changes. */
export async function updateTag(
  client: ClayverClient,
  tagId: string,
  changes: { name?: string; color?: string },
): Promise<void> {
  const patch: Partial<TagRecord> = {};
  if (changes.name !== undefined) patch.name = normalizeTagName(changes.name);
  if (changes.color !== undefined) patch.color = assertTagColor(changes.color);
  if (Object.keys(patch).length === 0) return;
  try {
    await update(ref(client.db, client.paths.tag(tagId)), patch);
  } catch (err) {
    throw toClayverError(err);
  }
}

/** Deletes a tag (admins only). A function then removes it from every conversation. */
export async function deleteTag(client: ClayverClient, tagId: string): Promise<void> {
  try {
    await remove(ref(client.db, client.paths.tag(tagId)));
  } catch (err) {
    throw toClayverError(err);
  }
}

/** Number of conversations that currently have the tag, from `tagIndex/{tagId}`. */
export async function countTagConversations(client: ClayverClient, tagId: string): Promise<number> {
  try {
    const snap = await get(ref(client.db, client.paths.tagIndex(tagId)));
    return snap.exists() ? snap.size : 0;
  } catch (err) {
    throw toClayverError(err);
  }
}

/** Live tag ids of one conversation, sorted. */
export function subscribeConversationTags(
  client: ClayverClient,
  conversationId: string,
  callback: (tagIds: string[]) => void,
  onError?: (err: ClayverError) => void,
): Unsubscribe {
  return onValue(
    ref(client.db, client.paths.conversationTags(conversationId)),
    (snap) => callback(snapshotToTagIds(snap.val() as Record<string, unknown> | null)),
    (err) => onError?.(toClayverError(err)),
  );
}

export async function addConversationTag(client: ClayverClient, conversationId: string, tagId: string): Promise<void> {
  try {
    await set(ref(client.db, client.paths.conversationTag(conversationId, tagId)), true);
  } catch (err) {
    throw toClayverError(err);
  }
}

export async function removeConversationTag(
  client: ClayverClient,
  conversationId: string,
  tagId: string,
): Promise<void> {
  try {
    await remove(ref(client.db, client.paths.conversationTag(conversationId, tagId)));
  } catch (err) {
    throw toClayverError(err);
  }
}

export interface TaggedConversationListOptions extends ConversationListOptions {
  tagId: string;
}

/**
 * Live list of the conversations that have `tagId`, in one status, newest
 * activity first. Same window semantics as `subscribeConversations`:
 * `tagIndex/{tagId}.orderByValue().startAt('{status}_').endAt('{status}_~').limitToLast(n)`,
 * then a live listener on each listed `conversations/{id}`.
 */
export function subscribeConversationsByTag(
  client: ClayverClient,
  options: TaggedConversationListOptions,
  callback: (state: ConversationListState) => void,
): ConversationListSubscription {
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_CONVERSATION_PAGE_SIZE);
  const { start, end } = statusOrderRange(options.status);
  const indexRef = ref(client.db, client.paths.tagIndex(options.tagId));
  let limit = pageSize;
  let ids: string[] = [];
  let indexLoaded = false;
  let error: ClayverError | null = null;
  let detachIndex: Unsubscribe | null = null;
  let closed = false;
  // One listener per listed conversation, kept across index updates.
  const rows = new Map<string, { detach: Unsubscribe; loaded: boolean; value: Conversation | null }>();

  const emit = () => {
    if (closed) return;
    const listed = ids.map((id) => rows.get(id)).filter((r) => r !== undefined);
    const conversations = listed
      .map((r) => r.value)
      // The index can lag a status change by a moment; trust the conversation itself.
      .filter((c): c is Conversation => !!c && c.status === options.status)
      .sort(compareConversationsByRecency);
    const loading = !error && (!indexLoaded || listed.some((r) => !r.loaded));
    callback({ conversations, loading, hasMore: indexLoaded && ids.length >= limit, error });
  };

  const syncRows = () => {
    const wanted = new Set(ids);
    for (const [id, row] of rows) {
      if (!wanted.has(id)) {
        row.detach();
        rows.delete(id);
      }
    }
    for (const id of ids) {
      if (rows.has(id)) continue;
      const row: { detach: Unsubscribe; loaded: boolean; value: Conversation | null } = {
        detach: () => undefined,
        loaded: false,
        value: null,
      };
      rows.set(id, row);
      row.detach = onValue(
        ref(client.db, client.paths.conversation(id)),
        (snap) => {
          const value = snap.val() as ConversationRecord | null;
          row.loaded = true;
          row.value = value ? { id, ...value } : null;
          emit();
        },
        (err) => {
          row.loaded = true;
          error = toClayverError(err);
          emit();
        },
      );
    }
  };

  const attach = () => {
    detachIndex?.();
    indexLoaded = false;
    emit();
    detachIndex = onValue(
      query(indexRef, orderByValue(), startAt(start), endAt(end), limitToLast(limit)),
      (snap) => {
        indexLoaded = true;
        error = null;
        ids = Object.keys((snap.val() as Record<string, string> | null) ?? {});
        syncRows();
        emit();
      },
      (err) => {
        indexLoaded = true;
        error = toClayverError(err);
        emit();
      },
    );
  };

  attach();

  return {
    loadMore() {
      if (closed) return;
      limit += pageSize;
      attach();
    },
    unsubscribe() {
      closed = true;
      detachIndex?.();
      detachIndex = null;
      for (const row of rows.values()) row.detach();
      rows.clear();
    },
  };
}
