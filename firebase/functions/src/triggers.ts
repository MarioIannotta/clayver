import { ServerValue } from "firebase-admin/database";
import { onValueCreated, onValueWritten } from "firebase-functions/v2/database";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "./admin";
import { DEVICE_STALE_AFTER_MS, REGION } from "./config";
import { mutateConversation, syncInbox } from "./conversations";
import { recordCustomerAccount } from "./customers";
import { paths, REGISTRY, registerWorkspace, type OwnerSegment } from "./paths";
import { applyConversationRateLimit, pruneExpiredBlocks } from "./moderation";
import { tokenHash } from "./push";
import type { Conversation, DeviceRegistration } from "./types";
import { recomputeUnread } from "./unread";

const conversationRef = "/clayver/projects/{projectId}/conversations/{conversationId}";

/** New conversation: initialise server fields, create the inbox entry, seed tags, rate-limit, record the customer's account, post the welcome message. */
export const clayverOnConversationCreated = onValueCreated(
  { ref: conversationRef, region: REGION },
  async (event) => {
    const { projectId, conversationId } = event.params;
    await registerWorkspace(projectId);
    await mutateConversation(projectId, conversationId, (c) => {
      if (c.rev) return false; // Already initialised by a previous attempt.
      c.updatedAt = c.updatedAt ?? c.createdAt;
      c.unread = c.unread ?? { customer: 0, agent: 0 };
      return true;
    });
    await syncInbox(projectId, conversationId);
    const customerId = (event.data.val() as Conversation | null)?.customerId;
    if (customerId) {
      await applyConversationRateLimit(projectId, customerId);
      await recordCustomerAccount(projectId, customerId);
    }

    const welcome = (await db().ref(`${paths.configPublic(projectId)}/welcomeMessage`).get()).val();
    if (typeof welcome === "string" && welcome.trim()) {
      // Deterministic id so a retried invocation doesn't post the welcome twice.
      await db()
        .ref(`${paths.messages(projectId, conversationId)}/${conversationId}-welcome`)
        .transaction((current) =>
          current ? undefined : { senderId: "system", senderType: "system", text: welcome, createdAt: ServerValue.TIMESTAMP },
        );
    }
  },
);

/** Agent opened or closed a conversation: keep statusOrder, closedAt and the inbox in step. */
export const clayverOnConversationStatusWritten = onValueWritten(
  { ref: `${conversationRef}/status`, region: REGION },
  async (event) => {
    const { projectId, conversationId } = event.params;
    const before = event.data.before.val();
    const after = event.data.after.val();
    if (!after || before === after) return;
    await mutateConversation(projectId, conversationId, (c: Conversation) => {
      const expectedOrder = `${c.status}_`;
      const closedOk = c.status === "closed" ? typeof c.closedAt === "number" : !c.closedAt;
      if (c.statusOrder?.startsWith(expectedOrder) && closedOk) return false;
      c.closedAt = c.status === "closed" ? Date.now() : null;
      c.updatedAt = Math.max(c.updatedAt ?? 0, Date.now());
      return true;
    });
    await syncInbox(projectId, conversationId);
  },
);

/** A read marker moved: recompute unread counters for both sides. */
export const clayverOnReadMarkerWritten = onValueWritten(
  { ref: "/clayver/projects/{projectId}/reads/{conversationId}/{side}", region: REGION },
  async (event) => {
    const { projectId, conversationId } = event.params;
    if (!event.data.after.exists()) return;
    await recomputeUnread(projectId, conversationId);
    await syncInbox(projectId, conversationId);
  },
);

/**
 * Keeps tokenIndex so each FCM token belongs to exactly one registration. When a
 * token shows up under a new owner (log out and in as someone else on the same
 * phone), the previous registration is deleted so it can't be notified twice.
 */
export const clayverOnDeviceWritten = onValueWritten(
  { ref: "/clayver/projects/{projectId}/devices/{ownerType}/{ownerId}/{deviceId}", region: REGION },
  async (event) => {
    const { projectId, ownerType, ownerId, deviceId } = event.params;
    if (ownerType !== "customers" && ownerType !== "agents") return;
    const before = event.data.before.val() as DeviceRegistration | null;
    const after = event.data.after.val() as DeviceRegistration | null;
    const self = { ownerType: ownerType as OwnerSegment, ownerId, deviceId };
    const isSelf = (v: typeof self | null) =>
      !!v && v.ownerType === self.ownerType && v.ownerId === self.ownerId && v.deviceId === self.deviceId;

    // Drop the index entry for a token this registration no longer holds.
    if (before?.pushToken && before.pushToken !== after?.pushToken) {
      await db()
        .ref(paths.tokenIndex(projectId, tokenHash(self.ownerType, before.pushToken)))
        // Returning null for a null first guess lets the admin SDK retry with the real value.
        .transaction((current) => (current === null || isSelf(current) ? null : undefined));
    }
    if (after?.pushToken && after.active === false) {
      // A deactivated registration gives its token up, even if a late event claimed it meanwhile.
      await db()
        .ref(paths.tokenIndex(projectId, tokenHash(self.ownerType, after.pushToken)))
        .transaction((current) => (current === null || isSelf(current) ? null : undefined));
    }
    if (!after?.pushToken || after.active === false) return;

    // Act on the registration as it is now, not as this (possibly late or retried) event saw it,
    // so a stale event can never claim a token for a registration that no longer holds it.
    const selfRef = db().ref(`${paths.devices(projectId, self.ownerType, ownerId)}/${deviceId}`);
    const now = (await selfRef.get()).val() as DeviceRegistration | null;
    if (!now || now.pushToken !== after.pushToken || now.active === false) return;

    let previous: typeof self | null = null;
    await db()
      .ref(paths.tokenIndex(projectId, tokenHash(self.ownerType, after.pushToken)))
      .transaction((current: typeof self | null) => {
        previous = current && !isSelf(current) ? current : null;
        return isSelf(current) ? undefined : self;
      });
    const prev = previous as typeof self | null;
    if (prev) {
      const prevRef = db().ref(`${paths.devices(projectId, prev.ownerType, prev.ownerId)}/${prev.deviceId}`);
      await prevRef.transaction((current: DeviceRegistration | null) =>
        current === null || current.pushToken === after.pushToken ? null : undefined,
      );
    }
  },
);

/** Daily: delete registrations that haven't been refreshed in 270 days, and expired blocks. */
export const clayverPruneStaleDevices = onSchedule({ schedule: "every 24 hours", region: REGION }, async () => {
  const cutoff = Date.now() - DEVICE_STALE_AFTER_MS;
  const workspaces = Object.keys((await db().ref(REGISTRY).get()).val() ?? {});
  for (const projectId of workspaces) {
    await pruneExpiredBlocks(projectId);
    for (const ownerType of ["customers", "agents"] as const) {
      const owners = ((await db().ref(`${paths.project(projectId)}/devices/${ownerType}`).get()).val() ?? {}) as Record<
        string,
        Record<string, DeviceRegistration>
      >;
      const devices: Record<string, null> = {};
      const index: Record<string, null> = {};
      for (const [ownerId, regs] of Object.entries(owners)) {
        for (const [deviceId, d] of Object.entries(regs ?? {})) {
          if (typeof d?.updatedAt !== "number" || d.updatedAt >= cutoff) continue;
          devices[`${ownerType}/${ownerId}/${deviceId}`] = null;
          if (d.pushToken) index[tokenHash(ownerType, d.pushToken)] = null;
        }
      }
      if (Object.keys(devices).length) await db().ref(`${paths.project(projectId)}/devices`).update(devices);
      if (Object.keys(index).length) await db().ref(`${paths.project(projectId)}/tokenIndex`).update(index);
    }
  }
});
