import { logger } from "firebase-functions/v2";
import { onValueCreated } from "firebase-functions/v2/database";
import { db } from "./admin";
import { REGION } from "./config";
import { mutateConversation, syncInbox } from "./conversations";
import { applyMessageRateLimit } from "./moderation";
import { paths } from "./paths";
import { agentRecipients, buildPush, collectTargets, notificationBody, sendToTargets } from "./push";
import type { AgentRecord, Conversation, Message } from "./types";
import { recomputeUnread } from "./unread";

/** Re-checks a persisted message against the role table (defense in depth on top of the rules). */
export async function senderIsAuthorized(projectId: string, conv: Conversation, msg: Message): Promise<boolean> {
  if (msg.senderType === "customer") return msg.senderId === conv.customerId;
  if (msg.senderType === "agent") {
    const agent = (await db().ref(paths.agent(projectId, msg.senderId)).get()).val() as AgentRecord | null;
    return agent?.active === true;
  }
  return msg.senderType === "system" && msg.senderId === "system";
}

export const clayverOnMessageCreated = onValueCreated(
  { ref: "/clayver/projects/{projectId}/messages/{conversationId}/{messageId}", region: REGION },
  async (event) => {
    const { projectId, conversationId, messageId } = event.params;
    const msg = event.data.val() as Message;
    const convSnap = await db().ref(paths.conversation(projectId, conversationId)).get();
    const conv = convSnap.val() as Conversation | null;
    if (!conv) {
      logger.warn("clayver message without conversation", { projectId, conversationId, messageId });
      return;
    }
    if (msg.senderType === "customer") await applyMessageRateLimit(projectId, conv.customerId);
    if (!(await senderIsAuthorized(projectId, conv, msg))) {
      // Rules make this unreachable for clients; a revoked agent racing a write is the realistic case.
      logger.error("clayver message from unauthorized sender, not fanning out", { projectId, conversationId, messageId });
      return;
    }

    const createdAt = typeof msg.createdAt === "number" ? msg.createdAt : Date.now();
    await mutateConversation(projectId, conversationId, (c) => {
      if (c.lastMessage && c.lastMessage.createdAt > createdAt) return false; // A newer message already landed.
      c.lastMessage = {
        text: (msg.text ?? "").slice(0, 200),
        senderType: msg.senderType,
        createdAt,
        hasAttachment: !!msg.attachment,
      };
      c.updatedAt = Math.max(c.updatedAt ?? 0, createdAt);
      if (msg.senderType === "customer" && c.status === "closed") {
        c.status = "open";
        c.closedAt = null;
      }
      return true;
    });
    await recomputeUnread(projectId, conversationId);
    await syncInbox(projectId, conversationId);

    if (msg.senderType === "system") return;

    // At-least-once delivery: claim the message before notifying so a retry doesn't push twice.
    const claim = await db()
      .ref(paths.notificationLog(projectId, messageId))
      .transaction((current) => (current ? undefined : { at: Date.now() }));
    if (!claim.committed) return;

    const fresh = ((await db().ref(paths.conversation(projectId, conversationId)).get()).val() ?? conv) as Conversation;
    if (msg.senderType === "customer") {
      const recipients = (await agentRecipients(projectId, fresh)).filter((uid) => uid !== msg.senderId);
      const targets = await collectTargets(projectId, "agents", recipients);
      const user = (await db().ref(paths.user(projectId, conv.customerId)).get()).val() ?? {};
      // `_name` and `_email` are the SDKs' UserProperty keys.
      const title = String(user?.properties?._name ?? user?.account?.displayName ?? user?.properties?._email ?? user?.account?.email ?? "New customer message").slice(0, 80);
      const result = await sendToTargets(projectId, targets, (t) =>
        buildPush(t, { projectId, conversationId, messageId, title, body: notificationBody(msg) }),
      );
      logger.info("clayver notified agents", { projectId, conversationId, messageId, ...result });
      return;
    }

    // Agent reply -> customer's devices, unless the customer turned notifications off.
    const enabled = (await db().ref(`${paths.user(projectId, conv.customerId)}/notifications/enabled`).get()).val();
    if (enabled === false) return;
    const targets = await collectTargets(projectId, "customers", [conv.customerId]);
    const [teamName, unreadTotal] = await Promise.all([
      db().ref(`${paths.configPublic(projectId)}/teamName`).get(),
      db().ref(`${paths.inbox(projectId, conv.customerId)}/unreadTotal`).get(),
    ]);
    const title = msg.senderName || teamName.val() || "Support";
    const result = await sendToTargets(projectId, targets, (t) =>
      buildPush(t, {
        projectId,
        conversationId,
        messageId,
        title: String(title).slice(0, 80),
        body: notificationBody(msg),
        badge: Number(unreadTotal.val() ?? 0),
      }),
    );
    logger.info("clayver notified customer", { projectId, conversationId, messageId, ...result });
  },
);
