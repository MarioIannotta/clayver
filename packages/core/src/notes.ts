/**
 * Internal notes (`notes/{conversationId}/{noteId}`): agent-only, never shown
 * to the customer and never pushed. Immutable; the author or an admin deletes.
 */
import { onValue, push, ref, remove, serverTimestamp, set } from "firebase/database";
import type { ClayverClient } from "./client.js";
import { ClayverError, toClayverError } from "./errors.js";
import type { AgentRole, Message, Note, NoteRecord, Unsubscribe } from "./types.js";
import { normalizeMessageText, MAX_SENDER_NAME_LENGTH } from "./validation.js";

/** Sorts notes by `createdAt`, then key. */
export function compareNotes(a: Note, b: Note): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Converts a `notes/{conversationId}` snapshot into a chronological list. */
export function snapshotToNotes(value: Record<string, NoteRecord> | null | undefined): Note[] {
  if (!value) return [];
  return Object.entries(value)
    .filter(([, n]) => n && typeof n === "object" && typeof n.text === "string")
    .map(([id, n]) => ({ id, ...n, createdAt: typeof n.createdAt === "number" ? n.createdAt : 0 }))
    .sort(compareNotes);
}

/** The author or an admin may delete a note. */
export function canDeleteNote(note: Pick<NoteRecord, "authorUid">, uid: string | undefined, role: AgentRole | null): boolean {
  return role === "admin" || (!!uid && note.authorUid === uid);
}

export function subscribeNotes(
  client: ClayverClient,
  conversationId: string,
  callback: (notes: Note[]) => void,
  onError?: (err: ClayverError) => void,
): Unsubscribe {
  return onValue(
    ref(client.db, client.paths.notes(conversationId)),
    (snap) => callback(snapshotToNotes(snap.val() as Record<string, NoteRecord> | null)),
    (err) => onError?.(toClayverError(err)),
  );
}

export interface AddNoteInput {
  conversationId: string;
  text: string;
  /** Shown as "Internal note · {authorName}". */
  authorName?: string;
}

/** Adds an internal note as the signed-in agent. Returns the note id. */
export async function addNote(client: ClayverClient, input: AddNoteInput): Promise<string> {
  const uid = client.auth.currentUser?.uid;
  if (!uid) throw new ClayverError("unauthenticated", "You are signed out.");
  const text = normalizeMessageText(input.text);
  if (!text) throw new ClayverError("invalid-argument", "Write a note.");
  const record: Record<string, unknown> = { authorUid: uid, text, createdAt: serverTimestamp() };
  const authorName = input.authorName?.trim().slice(0, MAX_SENDER_NAME_LENGTH);
  if (authorName) record.authorName = authorName;
  const noteRef = push(ref(client.db, client.paths.notes(input.conversationId)));
  try {
    await set(noteRef, record);
    return noteRef.key!;
  } catch (err) {
    throw toClayverError(err);
  }
}

export async function deleteNote(client: ClayverClient, conversationId: string, noteId: string): Promise<void> {
  try {
    await remove(ref(client.db, client.paths.note(conversationId, noteId)));
  } catch (err) {
    throw toClayverError(err);
  }
}

export type TimelineItem = { kind: "message"; at: number; message: Message } | { kind: "note"; at: number; note: Note };

/**
 * Interleaves messages (kept in their key order) and notes by `createdAt`: a
 * note goes before the first message created after it. While older messages
 * are not loaded yet (`hasOlderMessages`), notes older than the oldest loaded
 * message are held back so they don't pile up at the top.
 */
export function buildTimeline(messages: Message[], notes: Note[], hasOlderMessages = false): TimelineItem[] {
  const oldest = messages[0]?.createdAt;
  const pending = [...notes]
    .sort(compareNotes)
    .filter((n) => !(hasOlderMessages && oldest !== undefined && n.createdAt < oldest));
  const items: TimelineItem[] = [];
  let i = 0;
  for (const m of messages) {
    while (i < pending.length && pending[i]!.createdAt < m.createdAt) {
      const note = pending[i++]!;
      items.push({ kind: "note", at: note.createdAt, note });
    }
    items.push({ kind: "message", at: m.createdAt, message: m });
  }
  for (; i < pending.length; i++) items.push({ kind: "note", at: pending[i]!.createdAt, note: pending[i]! });
  return items;
}
