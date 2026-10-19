/**
 * `statusOrder` is written by Cloud Functions as
 * `"{status}_{updatedAt zero-padded to 15}"` so agents can query one status
 * ordered by recency with a single `orderByChild('statusOrder')` index.
 */
import type { ConversationStatus, ConversationRecord } from "./types.js";

export const STATUS_ORDER_PAD = 15;

export function formatStatusOrder(status: ConversationStatus, updatedAt: number): string {
  const ms = Math.max(0, Math.floor(updatedAt));
  return `${status}_${String(ms).padStart(STATUS_ORDER_PAD, "0")}`;
}

export interface ParsedStatusOrder {
  status: ConversationStatus;
  updatedAt: number;
}

const STATUS_ORDER_RE = /^(open|closed)_(\d{15})$/;

/** Returns `null` for anything that is not a well-formed statusOrder. */
export function parseStatusOrder(value: unknown): ParsedStatusOrder | null {
  if (typeof value !== "string") return null;
  const match = STATUS_ORDER_RE.exec(value);
  if (!match) return null;
  return { status: match[1] as ConversationStatus, updatedAt: Number(match[2]) };
}

/** `startAt` / `endAt` bounds selecting every conversation with `status`. */
export function statusOrderRange(status: ConversationStatus): { start: string; end: string } {
  return { start: `${status}_`, end: `${status}_~` };
}

/**
 * Best-effort recency of a conversation: `updatedAt`, else the time encoded in
 * `statusOrder`, else the last message, else `createdAt`.
 */
export function conversationActivityAt(c: ConversationRecord): number {
  return (
    c.updatedAt ??
    parseStatusOrder(c.statusOrder)?.updatedAt ??
    c.lastMessage?.createdAt ??
    c.createdAt ??
    0
  );
}

/** Sort comparator: most recently active first, ties broken by key. */
export function compareConversationsByRecency<T extends ConversationRecord & { id: string }>(
  a: T,
  b: T,
): number {
  const diff = conversationActivityAt(b) - conversationActivityAt(a);
  if (diff !== 0) return diff;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}
