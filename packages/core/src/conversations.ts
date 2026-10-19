/**
 * Conversation list and conversation-level actions for agents.
 */
import {
  endAt,
  limitToLast,
  onValue,
  orderByChild,
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
import type {
  Conversation,
  ConversationPriority,
  ConversationRecord,
  ConversationStage,
  ConversationTriage,
  ConversationStatus,
  ReadMarkers,
  Unsubscribe,
} from "./types.js";

export const DEFAULT_CONVERSATION_PAGE_SIZE = 30;

export interface ConversationListState {
  /** Most recently active first. */
  conversations: Conversation[];
  /** True while the first snapshot for the current page size is loading. */
  loading: boolean;
  /** True when older conversations may exist beyond the loaded window. */
  hasMore: boolean;
  error: ClayverError | null;
}

export interface ConversationListSubscription {
  /** Extends the live window by one page. */
  loadMore(): void;
  unsubscribe: Unsubscribe;
}

export interface ConversationListOptions {
  status: ConversationStatus;
  pageSize?: number;
}

/** Turns a `conversations` snapshot value into a sorted array. */
export function snapshotToConversations(
  value: Record<string, ConversationRecord> | null | undefined,
): Conversation[] {
  if (!value) return [];
  return Object.entries(value)
    .map(([id, c]) => ({ id, ...c }))
    .sort(compareConversationsByRecency);
}

/**
 * Live list of conversations in one status, newest activity first, using
 * `orderByChild('statusOrder').startAt('{status}_').endAt('{status}_~').limitToLast(n)`.
 *
 * Pagination grows the live window (`n += pageSize`) rather than issuing
 * one-shot "older" queries, so every loaded row keeps updating in real time
 * and rows move between pages correctly as conversations get new messages.
 */
export function subscribeConversations(
  client: ClayverClient,
  options: ConversationListOptions,
  callback: (state: ConversationListState) => void,
): ConversationListSubscription {
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_CONVERSATION_PAGE_SIZE);
  const { start, end } = statusOrderRange(options.status);
  let limit = pageSize;
  let current: Conversation[] = [];
  let detach: Unsubscribe | null = null;
  let closed = false;

  const attach = () => {
    detach?.();
    callback({ conversations: current, loading: true, hasMore: false, error: null });
    const q = query(
      ref(client.db, client.paths.conversations()),
      orderByChild("statusOrder"),
      startAt(start),
      endAt(end),
      limitToLast(limit),
    );
    detach = onValue(
      q,
      (snap) => {
        current = snapshotToConversations(snap.val() as Record<string, ConversationRecord> | null);
        callback({
          conversations: current,
          loading: false,
          hasMore: current.length >= limit,
          error: null,
        });
      },
      (err) => {
        callback({ conversations: current, loading: false, hasMore: false, error: toClayverError(err) });
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
      detach?.();
      detach = null;
    },
  };
}

export function subscribeConversation(
  client: ClayverClient,
  conversationId: string,
  callback: (conversation: Conversation | null) => void,
  onError?: (err: ClayverError) => void,
): Unsubscribe {
  return onValue(
    ref(client.db, client.paths.conversation(conversationId)),
    (snap) => {
      const value = snap.val() as ConversationRecord | null;
      callback(value ? { id: conversationId, ...value } : null);
    },
    (err) => onError?.(toClayverError(err)),
  );
}

/** Opens or closes a conversation. The function syncs statusOrder/closedAt. */
export async function setConversationStatus(
  client: ClayverClient,
  conversationId: string,
  status: ConversationStatus,
): Promise<void> {
  if (status !== "open" && status !== "closed") {
    throw new ClayverError("invalid-argument", `Invalid status "${String(status)}".`);
  }
  try {
    await update(ref(client.db, client.paths.conversation(conversationId)), { status });
  } catch (err) {
    throw toClayverError(err);
  }
}

/**
 * Assigns the conversation to an active agent, or unassigns it with `null`.
 */
export async function assignConversation(
  client: ClayverClient,
  conversationId: string,
  assigneeUid: string | null,
): Promise<void> {
  const path = `${client.paths.conversation(conversationId)}/assigneeUid`;
  try {
    if (assigneeUid) await set(ref(client.db, path), assigneeUid);
    else await remove(ref(client.db, path));
  } catch (err) {
    throw toClayverError(err);
  }
}

/** Sets or clears (`null`) the conversation's priority. */
export async function setConversationPriority(
  client: ClayverClient,
  conversationId: string,
  priority: ConversationPriority | null,
): Promise<void> {
  await setOrRemove(client, `${client.paths.triage(conversationId)}/priority`, priority);
}

/** Sets or clears (`null`) where the team's work on the conversation stands. */
export async function setConversationStage(
  client: ClayverClient,
  conversationId: string,
  stage: ConversationStage | null,
): Promise<void> {
  await setOrRemove(client, `${client.paths.triage(conversationId)}/stage`, stage);
}

/** Live priority and stage of every conversation, keyed by conversation id (agents only). */
export function subscribeTriage(
  client: ClayverClient,
  onChange: (triage: Record<string, ConversationTriage>) => void,
  onError?: (err: ClayverError) => void,
): Unsubscribe {
  return onValue(
    ref(client.db, client.paths.triageRoot()),
    (snap) => onChange((snap.val() ?? {}) as Record<string, ConversationTriage>),
    (err) => onError?.(toClayverError(err)),
  );
}

async function setOrRemove(client: ClayverClient, path: string, value: string | null): Promise<void> {
  try {
    if (value) await set(ref(client.db, path), value);
    else await remove(ref(client.db, path));
  } catch (err) {
    throw toClayverError(err);
  }
}

/** Assigns the conversation to the signed-in agent. */
export async function assignToMe(client: ClayverClient, conversationId: string): Promise<void> {
  const uid = client.auth.currentUser?.uid;
  if (!uid) throw new ClayverError("unauthenticated", "You are signed out.");
  await assignConversation(client, conversationId, uid);
}

/**
 * Writes the shared team read marker `reads/{id}/agent = { lastReadAt, uid }`.
 * The function then recomputes `unread.agent`.
 */
export async function markReadAsAgent(client: ClayverClient, conversationId: string): Promise<void> {
  const uid = client.auth.currentUser?.uid;
  if (!uid) throw new ClayverError("unauthenticated", "You are signed out.");
  try {
    await set(ref(client.db, client.paths.agentRead(conversationId)), {
      lastReadAt: serverTimestamp(),
      uid,
    });
  } catch (err) {
    throw toClayverError(err);
  }
}

/** Live read markers of both sides (used for "Seen" receipts). */
export function subscribeReadMarkers(
  client: ClayverClient,
  conversationId: string,
  callback: (reads: ReadMarkers) => void,
  onError?: (err: ClayverError) => void,
): Unsubscribe {
  return onValue(
    ref(client.db, client.paths.reads(conversationId)),
    (snap) => callback((snap.val() as ReadMarkers | null) ?? {}),
    (err) => onError?.(toClayverError(err)),
  );
}

/** True when the customer's read marker covers a message created at `createdAt`. */
export function isSeenByCustomer(reads: ReadMarkers | null | undefined, createdAt: number): boolean {
  const at = reads?.customer?.lastReadAt;
  return typeof at === "number" && createdAt <= at;
}

/**
 * Whether the agent read marker should be (re)written: there are unread
 * customer messages, or the newest customer message is newer than the marker.
 */
export function needsAgentRead(
  conversation: Pick<ConversationRecord, "unread" | "lastMessage"> | null | undefined,
  reads: ReadMarkers | null | undefined,
  newestCustomerMessageAt?: number,
): boolean {
  if (!conversation) return false;
  if ((conversation.unread?.agent ?? 0) > 0) return true;
  const lastRead = reads?.agent?.lastReadAt ?? 0;
  if (newestCustomerMessageAt !== undefined && newestCustomerMessageAt > lastRead) return true;
  const lm = conversation.lastMessage;
  return !!lm && lm.senderType === "customer" && lm.createdAt > lastRead;
}
