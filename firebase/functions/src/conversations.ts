import { db } from "./admin";
import { paths, statusOrder } from "./paths";
import { syncTagIndex } from "./tags";
import type { Conversation, InboxEntry } from "./types";

/**
 * Applies a server-side change to a conversation inside a transaction and bumps
 * `rev`, so readers (the inbox sync) can tell newer state from older state.
 * `mutate` returns false to leave the conversation untouched.
 */
export async function mutateConversation(
  projectId: string,
  conversationId: string,
  mutate: (conv: Conversation) => boolean,
): Promise<Conversation | null> {
  const ref = db().ref(paths.conversation(projectId, conversationId));
  const result = await ref.transaction((current: Conversation | null) => {
    if (!current) return current; // Admin transactions start from a cached null; retry happens with real data.
    const next: Conversation = { ...current };
    if (current.unread) next.unread = { ...current.unread };
    if (!mutate(next)) return undefined;
    next.rev = (current.rev ?? 0) + 1;
    next.updatedAt = next.updatedAt ?? next.createdAt;
    next.statusOrder = statusOrder(next.status, next.updatedAt);
    return next;
  });
  return (result.snapshot.val() as Conversation | null) ?? null;
}

export function inboxEntry(conv: Conversation): InboxEntry {
  return {
    status: conv.status,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt ?? conv.createdAt,
    lastMessage: conv.lastMessage ?? null,
    unread: conv.unread?.customer ?? 0,
    rev: conv.rev ?? 0,
  };
}

/**
 * Copies the conversation's customer-facing state into inbox/{cid} and recomputes
 * unreadTotal, and refreshes the conversation's tagIndex entries. Entries only move forward in `rev`, so a slow invocation can never
 * overwrite newer state written by a faster one.
 */
export async function syncInbox(projectId: string, conversationId: string): Promise<void> {
  // The tag index carries statusOrder too, so it moves whenever the inbox does.
  await syncTagIndex(projectId, conversationId);
  const snap = await db().ref(paths.conversation(projectId, conversationId)).get();
  const conv = snap.val() as Conversation | null;
  if (!conv?.customerId) return;
  const entry = inboxEntry(conv);
  const ref = db().ref(paths.inbox(projectId, conv.customerId));
  await ref.transaction(
    (current: { conversations?: Record<string, InboxEntry>; unreadTotal?: number } | null) => {
      const next = { conversations: { ...(current?.conversations ?? {}) }, unreadTotal: 0 };
      const existing = next.conversations[conversationId];
      if (!existing || (existing.rev ?? 0) <= entry.rev) next.conversations[conversationId] = entry;
      next.unreadTotal = Object.values(next.conversations).reduce((sum, e) => sum + (e?.unread ?? 0), 0);
      return next;
    },
  );
}
