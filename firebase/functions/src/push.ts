import { createHash } from "node:crypto";
import type { BaseMessage, SendResponse } from "firebase-admin/messaging";
import { logger } from "firebase-functions/v2";
import { db, messaging } from "./admin";
import { dashboardUrl } from "./config";
import { paths, type OwnerSegment } from "./paths";
import type { AgentRecord, Conversation, DeviceRegistration, Message } from "./types";

/** Index key for a token within one audience: the same phone may be both a customer and an agent device. */
export function tokenHash(ownerType: OwnerSegment, token: string): string {
  return createHash("sha256").update(`${ownerType}:${token}`, "utf8").digest("hex");
}

export interface Target {
  ownerType: OwnerSegment;
  ownerId: string;
  deviceId: string;
  token: string;
  platform: DeviceRegistration["platform"];
}

/** Error codes meaning the token will never work again. */
export const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

export function notificationBody(message: Message): string {
  const text = (message.text ?? "").trim();
  if (text) return text.length > 180 ? `${text.slice(0, 177)}...` : text;
  if (message.attachment?.contentType?.startsWith("image/")) return "📷 Photo";
  if (message.attachment) return `📎 ${message.attachment.fileName}`;
  return "New message";
}

/** Active, de-duplicated device registrations for the given owners. */
export async function collectTargets(
  projectId: string,
  ownerType: OwnerSegment,
  ownerIds: string[],
): Promise<Target[]> {
  const seen = new Set<string>();
  const targets: Target[] = [];
  for (const ownerId of ownerIds) {
    const snap = await db().ref(paths.devices(projectId, ownerType, ownerId)).get();
    const devices = (snap.val() ?? {}) as Record<string, DeviceRegistration>;
    for (const [deviceId, device] of Object.entries(devices)) {
      if (!device?.active || !device.pushToken || seen.has(device.pushToken)) continue;
      seen.add(device.pushToken);
      targets.push({ ownerType, ownerId, deviceId, token: device.pushToken, platform: device.platform });
    }
  }
  return targets;
}

/** Which agents hear about a customer message: the assignee if active, otherwise every active agent. */
export async function agentRecipients(projectId: string, conv: Conversation): Promise<string[]> {
  const [agentsSnap, privateSnap] = await Promise.all([
    db().ref(paths.agents(projectId)).get(),
    db().ref(paths.configPrivate(projectId)).get(),
  ]);
  const agents = (agentsSnap.val() ?? {}) as Record<string, AgentRecord>;
  const active = Object.entries(agents)
    .filter(([, a]) => a?.active === true)
    .map(([uid]) => uid);
  const mode = privateSnap.child("notifyAgents").val() ?? "assignee_or_all";
  let recipients = active;
  if (mode === "assignee_or_all" && conv.assigneeUid && active.includes(conv.assigneeUid)) {
    recipients = [conv.assigneeUid];
  }
  // Respect each agent's own push preference.
  const prefs = await Promise.all(
    recipients.map((uid) => db().ref(`${paths.agentSettings(projectId, uid)}/notifications/push`).get()),
  );
  return recipients.filter((_, i) => prefs[i].val() !== false);
}

export function buildPush(
  target: Target,
  args: { projectId: string; conversationId: string; messageId: string; title: string; body: string; badge?: number },
): BaseMessage & { token: string } {
  const { projectId, conversationId, messageId, title, body, badge } = args;
  const link = `clayver://conversation/${conversationId}`;
  const audience = target.ownerType === "agents" ? "agent" : "customer";
  const data = { clayver: "1", type: "message", audience, projectId, conversationId, messageId, link };
  const base = dashboardUrl.value().replace(/\/$/, "");
  return {
    token: target.token,
    notification: { title, body },
    data,
    android: {
      priority: "high",
      collapseKey: conversationId,
      notification: {
        channelId: audience === "agent" ? "clayver_agent_messages" : "clayver_messages",
        tag: conversationId, clickAction: "CLAYVER_OPEN_CONVERSATION" },
    },
    apns: {
      headers: { "apns-collapse-id": conversationId.slice(0, 64) },
      payload: {
        aps: { sound: "default", threadId: conversationId, ...(badge !== undefined ? { badge } : {}) },
      },
    },
    webpush: {
      notification: { title, body, tag: conversationId, renotify: true },
      ...(base ? { fcmOptions: { link: `${base}/conversations/${conversationId}` } } : {}),
    },
  };
}

/**
 * Sends one push per registration and deactivates registrations whose token
 * FCM reports as permanently invalid.
 */
export async function sendToTargets(
  projectId: string,
  targets: Target[],
  build: (t: Target) => BaseMessage & { token: string },
): Promise<{ sent: number; invalidated: number }> {
  let sent = 0;
  let invalidated = 0;
  for (let i = 0; i < targets.length; i += 500) {
    const batch = targets.slice(i, i + 500);
    const response = emulatorSinkEnabled()
      ? await sendToEmulatorSink(projectId, batch.map(build))
      : await messaging().sendEach(batch.map(build));
    await Promise.all(
      response.responses.map(async (r: SendResponse, j: number) => {
        if (r.success) {
          sent++;
          return;
        }
        const code = r.error?.code ?? "";
        if (!INVALID_TOKEN_CODES.has(code)) {
          logger.warn("clayver push failed", { code, deviceId: batch[j].deviceId });
          return;
        }
        invalidated++;
        await invalidateRegistration(projectId, batch[j]);
      }),
    );
  }
  return { sent, invalidated };
}

export async function invalidateRegistration(projectId: string, t: Target): Promise<void> {
  const ref = db().ref(`${paths.devices(projectId, t.ownerType, t.ownerId)}/${t.deviceId}`);
  await ref.transaction((current: DeviceRegistration | null) => {
    if (current === null) return null; // First guess; the SDK retries with the stored value.
    if (current.pushToken !== t.token) return undefined; // Token was refreshed meanwhile.
    return { ...current, active: false, invalidatedAt: Date.now() };
  });
  await db().ref(paths.tokenIndex(projectId, tokenHash(t.ownerType, t.token))).remove();
}

/**
 * FCM cannot be emulated, so under the Functions emulator (and only there) pushes
 * can be recorded to the database for integration tests. Tokens starting with
 * "invalid-" fail the way FCM fails for unregistered tokens.
 */
function emulatorSinkEnabled(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true" && process.env.CLAYVER_EMULATOR_FCM_SINK === "true";
}

async function sendToEmulatorSink(
  projectId: string,
  messages: Array<BaseMessage & { token: string }>,
): Promise<{ responses: SendResponse[] }> {
  const responses: SendResponse[] = [];
  for (const m of messages) {
    if (m.token.startsWith("invalid-")) {
      const error = Object.assign(new Error("Requested entity was not found."), {
        code: "messaging/registration-token-not-registered",
      });
      responses.push({ success: false, error } as unknown as SendResponse);
      continue;
    }
    await db().ref(`clayverEmulator/pushes/${projectId}`).push({ ...JSON.parse(JSON.stringify(m)), sentAt: Date.now() });
    responses.push({ success: true, messageId: "emulator" } as SendResponse);
  }
  return { responses };
}
