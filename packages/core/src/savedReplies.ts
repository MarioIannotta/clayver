/**
 * Saved replies (`savedReplies/{replyId}`): team-shared canned responses.
 * Any agent creates and edits; the creator or an admin deletes.
 */
import { onValue, push, ref, remove, serverTimestamp, set, update } from "firebase/database";
import type { ClayverClient } from "./client.js";
import { ClayverError, toClayverError } from "./errors.js";
import { foldForSearch } from "./tags.js";
import type { AgentRole, SavedReply, SavedReplyRecord, Unsubscribe } from "./types.js";
import { MAX_TEXT_LENGTH } from "./validation.js";

export const MAX_SAVED_REPLY_TITLE_LENGTH = 80;

export interface SavedReplyInput {
  title: string;
  text: string;
}

/** Trims and length-checks a saved reply. */
export function normalizeSavedReply(input: SavedReplyInput): SavedReplyInput {
  const title = (input.title ?? "").trim();
  const text = (input.text ?? "").trim();
  if (!title || title.length > MAX_SAVED_REPLY_TITLE_LENGTH) {
    throw new ClayverError("invalid-argument", `A title must be 1-${MAX_SAVED_REPLY_TITLE_LENGTH} characters.`);
  }
  if (!text || text.length > MAX_TEXT_LENGTH) {
    throw new ClayverError("invalid-argument", `The reply text must be 1-${MAX_TEXT_LENGTH} characters.`);
  }
  return { title, text };
}

/** Converts the `savedReplies` node into a list sorted by title. */
export function snapshotToSavedReplies(value: Record<string, SavedReplyRecord> | null | undefined): SavedReply[] {
  if (!value) return [];
  return Object.entries(value)
    .filter(([, r]) => r && typeof r === "object" && typeof r.title === "string" && typeof r.text === "string")
    .map(([id, r]) => ({ id, ...r }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || (a.id < b.id ? -1 : 1));
}

/** Replies matching `search` in the title or text; title-prefix matches first, then title, then text. */
export function filterSavedReplies(replies: SavedReply[], search: string): SavedReply[] {
  const q = foldForSearch(search.trim());
  if (!q) return replies;
  const ranked: [number, SavedReply][] = [];
  for (const r of replies) {
    const title = foldForSearch(r.title);
    const rank = title.startsWith(q) ? 0 : title.includes(q) ? 1 : foldForSearch(r.text).includes(q) ? 2 : -1;
    if (rank >= 0) ranked.push([rank, r]);
  }
  return ranked.sort((a, b) => a[0] - b[0]).map(([, r]) => r);
}

/** The creator or an admin may delete a saved reply. */
export function canDeleteSavedReply(
  reply: Pick<SavedReplyRecord, "createdBy">,
  uid: string | undefined,
  role: AgentRole | null,
): boolean {
  return role === "admin" || (!!uid && reply.createdBy === uid);
}

/**
 * The composer's "/" shortcut: when the text is a single `/word` at the start
 * (no newline yet), returns the search after the slash, else null.
 */
export function savedReplyShortcutQuery(text: string): string | null {
  const match = /^\/([^\n]*)$/.exec(text);
  return match ? match[1]! : null;
}

export function subscribeSavedReplies(
  client: ClayverClient,
  callback: (replies: SavedReply[]) => void,
  onError?: (err: ClayverError) => void,
): Unsubscribe {
  return onValue(
    ref(client.db, client.paths.savedReplies()),
    (snap) => callback(snapshotToSavedReplies(snap.val() as Record<string, SavedReplyRecord> | null)),
    (err) => onError?.(toClayverError(err)),
  );
}

/** Creates a saved reply. Returns its id. */
export async function createSavedReply(client: ClayverClient, input: SavedReplyInput): Promise<string> {
  const uid = client.auth.currentUser?.uid;
  if (!uid) throw new ClayverError("unauthenticated", "You are signed out.");
  const { title, text } = normalizeSavedReply(input);
  const replyRef = push(ref(client.db, client.paths.savedReplies()));
  try {
    await set(replyRef, {
      title,
      text,
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return replyRef.key!;
  } catch (err) {
    throw toClayverError(err);
  }
}

export async function updateSavedReply(client: ClayverClient, replyId: string, input: SavedReplyInput): Promise<void> {
  const { title, text } = normalizeSavedReply(input);
  try {
    await update(ref(client.db, client.paths.savedReply(replyId)), { title, text, updatedAt: serverTimestamp() });
  } catch (err) {
    throw toClayverError(err);
  }
}

export async function deleteSavedReply(client: ClayverClient, replyId: string): Promise<void> {
  try {
    await remove(ref(client.db, client.paths.savedReply(replyId)));
  } catch (err) {
    throw toClayverError(err);
  }
}
