import { db } from "./admin";
import { mutateConversation } from "./conversations";
import { paths } from "./paths";
import type { Message, UnreadBasis } from "./types";

/** `a` is at least as new as `b` in every respect. */
export function dominates(a: UnreadBasis, b: UnreadBasis | undefined): boolean {
  if (!b) return true;
  return a.customerReadAt >= b.customerReadAt && a.agentReadAt >= b.agentReadAt && a.lastMessageAt >= b.lastMessageAt;
}

/**
 * Pure counting rule. The customer has unread agent replies; agents have unread
 * customer messages. System messages (welcome, notices) never count.
 */
export function countUnread(
  messages: Message[],
  customerReadAt: number,
  agentReadAt: number,
): { customer: number; agent: number; lastMessageAt: number } {
  let customer = 0;
  let agent = 0;
  let lastMessageAt = 0;
  for (const m of messages) {
    if (typeof m?.createdAt !== "number") continue;
    lastMessageAt = Math.max(lastMessageAt, m.createdAt);
    if (m.senderType === "agent" && m.createdAt > customerReadAt) customer++;
    if (m.senderType === "customer" && m.createdAt > agentReadAt) agent++;
  }
  return { customer, agent, lastMessageAt };
}

/**
 * Recomputes conversation.unread from the messages and the read markers.
 * Counters are recomputed rather than incremented, so retried or concurrent
 * invocations converge on the right value. The write only lands when its inputs
 * are at least as new as the inputs of the value already stored; otherwise it
 * re-reads and tries again.
 */
export async function recomputeUnread(projectId: string, conversationId: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [readsSnap, convSnap] = await Promise.all([
      db().ref(paths.reads(projectId, conversationId)).get(),
      db().ref(paths.conversation(projectId, conversationId)).get(),
    ]);
    if (!convSnap.exists()) return;
    const customerReadAt = Number(readsSnap.child("customer/lastReadAt").val() ?? 0);
    const agentReadAt = Number(readsSnap.child("agent/lastReadAt").val() ?? 0);
    const since = Math.min(customerReadAt, agentReadAt);

    // Only messages newer than the oldest read marker can be unread for anyone.
    const msgsSnap = await db()
      .ref(paths.messages(projectId, conversationId))
      .orderByChild("createdAt")
      .startAfter(since)
      .get();
    const messages: Message[] = [];
    msgsSnap.forEach((child) => {
      messages.push(child.val() as Message);
    });
    const counted = countUnread(messages, customerReadAt, agentReadAt);
    const lastMessageAt = Math.max(counted.lastMessageAt, Number(convSnap.child("lastMessage/createdAt").val() ?? 0));
    const basis: UnreadBasis = { customerReadAt, agentReadAt, lastMessageAt };

    let stale = false;
    await mutateConversation(projectId, conversationId, (conv) => {
      stale = false;
      if (!dominates(basis, conv.unreadBasis)) {
        stale = true;
        return false;
      }
      conv.unread = { customer: counted.customer, agent: counted.agent };
      conv.unreadBasis = basis;
      return true;
    });
    if (!stale) return;
  }
}
