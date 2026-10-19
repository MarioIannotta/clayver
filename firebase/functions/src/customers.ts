import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { auth, db } from "./admin";
import { CALLABLE } from "./config";
import { paths } from "./paths";
import { tokenHash } from "./push";
import { isActiveAdmin } from "./roles";
import type { Conversation, CustomerAccount, DeviceRegistration } from "./types";
import { requireAuth, requireProjectId, requireString } from "./validation";

const CUSTOMER_ID_RE = /^[^.#$/[\]]{1,128}$/;

function requireCustomerId(value: unknown): string {
  const id = requireString(value, "customerId", 1, 128);
  if (!CUSTOMER_ID_RE.test(id)) throw new HttpsError("invalid-argument", "customerId is not a valid key.");
  return id;
}

async function customerConversations(projectId: string, customerId: string): Promise<Record<string, Conversation>> {
  const snap = await db()
    .ref(`${paths.project(projectId)}/conversations`)
    .orderByChild("customerId")
    .equalTo(customerId)
    .get();
  return (snap.val() ?? {}) as Record<string, Conversation>;
}

/**
 * Copies the customer's Firebase Auth account (anonymous or signed in, email, name) to
 * `users/{cid}/account`, so agents see who they are talking to. The customer id is the uid.
 */
export async function recordCustomerAccount(projectId: string, customerId: string): Promise<void> {
  let account: CustomerAccount;
  try {
    const user = await auth().getUser(customerId);
    account = {
      anonymous: user.providerData.length === 0,
      email: user.email ?? null,
      emailVerified: user.emailVerified,
      displayName: user.displayName ?? null,
      updatedAt: Date.now(),
    };
  } catch (err) {
    if ((err as { code?: string }).code === "auth/user-not-found") return;
    throw err;
  }
  await db().ref(paths.user(projectId, customerId)).update({ account });
  await db()
    .ref(`${paths.user(projectId, customerId)}/createdAt`)
    .transaction((current) => (typeof current === "number" ? undefined : Date.now()));
}

/** Erases everything stored for one customer. See "Deleting a customer" in the data model. */
export async function deleteCustomerData(projectId: string, customerId: string): Promise<void> {
  const project = paths.project(projectId);
  const updates: Record<string, null> = {};

  for (const conversationId of Object.keys(await customerConversations(projectId, customerId))) {
    const tags = Object.keys(((await db().ref(paths.conversationTags(projectId, conversationId)).get()).val() ?? {}) as object);
    for (const tag of tags) updates[`tagIndex/${tag}/${conversationId}`] = null;
    for (const node of ["conversations", "messages", "reads", "conversationTags", "notes", "triage"]) {
      updates[`${node}/${conversationId}`] = null;
    }
  }

  const devices = ((await db().ref(paths.devices(projectId, "customers", customerId)).get()).val() ?? {}) as Record<
    string,
    DeviceRegistration
  >;
  for (const d of Object.values(devices)) if (d?.pushToken) updates[`tokenIndex/${tokenHash("customers", d.pushToken)}`] = null;
  for (const node of ["users", "inbox", "moderation", "limits", "devices/customers"]) {
    updates[`${node}/${customerId}`] = null;
  }

  await db().ref(project).update(updates);

  try {
    await getStorage().bucket().deleteFiles({ prefix: `${project}/customers/${customerId}/` });
  } catch (err) {
    logger.error("clayver could not delete customer attachments", { projectId, customerId, err: String(err) });
    throw new HttpsError("internal", "Customer data was deleted but some attachments could not be. Try again.");
  }
  logger.info("clayver deleted customer data", { projectId, customerId });
}

export async function exportCustomerData(projectId: string, customerId: string): Promise<Record<string, unknown>> {
  const get = async (path: string) => (await db().ref(path).get()).val();
  const devices = ((await get(paths.devices(projectId, "customers", customerId))) ?? {}) as Record<string, DeviceRegistration & Record<string, unknown>>;
  const conversations = [];
  for (const [id, conv] of Object.entries(await customerConversations(projectId, customerId))) {
    const [messages, notes, tags, triage] = await Promise.all([
      get(paths.messages(projectId, id)),
      get(paths.notes(projectId, id)),
      get(paths.conversationTags(projectId, id)),
      get(paths.triage(projectId, id)),
    ]);
    conversations.push({
      id,
      ...conv,
      ...(triage ?? {}),
      tags: Object.keys(tags ?? {}),
      messages: Object.entries(messages ?? {}).map(([mid, m]) => ({ id: mid, ...(m as object) })),
      notes: Object.entries(notes ?? {}).map(([nid, n]) => ({ id: nid, ...(n as object) })),
    });
  }
  conversations.sort((a, b) => a.createdAt - b.createdAt);
  return {
    exportedAt: new Date().toISOString(),
    projectId,
    customer: {
      customerId,
      ...((await get(paths.user(projectId, customerId))) ?? {}),
      moderation: (await get(paths.moderation(projectId, customerId))) ?? null,
      // Push tokens are credentials for the device, not customer data, so they're left out.
      devices: Object.entries(devices).map(([deviceId, d]) => ({
        deviceId,
        platform: d.platform,
        active: d.active,
        updatedAt: d.updatedAt,
        appVersion: d.appVersion ?? null,
        sdkVersion: d.sdkVersion ?? null,
        locale: d.locale ?? null,
      })),
    },
    conversations,
  };
}

async function requireAdmin(projectId: string, uid: string): Promise<void> {
  if (!(await isActiveAdmin(projectId, uid))) throw new HttpsError("permission-denied", "Only admins can do this.");
}

/** The signed-in customer erases their own data (App Store / GDPR account deletion). */
export const clayverDeleteMyData = onCall(CALLABLE, async (request) => {
  const caller = requireAuth(request.auth);
  const projectId = requireProjectId(request.data?.projectId);
  // The customer id is the Firebase Auth uid.
  await deleteCustomerData(projectId, caller.uid);
  return { deleted: true };
});

export const clayverDeleteCustomer = onCall(CALLABLE, async (request) => {
  const caller = requireAuth(request.auth);
  const projectId = requireProjectId(request.data?.projectId);
  const customerId = requireCustomerId(request.data?.customerId);
  await requireAdmin(projectId, caller.uid);
  await deleteCustomerData(projectId, customerId);
  logger.info("clayver customer deleted by admin", { projectId, customerId, by: caller.uid });
  return { deleted: true };
});

export const clayverExportCustomer = onCall(CALLABLE, async (request) => {
  const caller = requireAuth(request.auth);
  const projectId = requireProjectId(request.data?.projectId);
  const customerId = requireCustomerId(request.data?.customerId);
  await requireAdmin(projectId, caller.uid);
  return exportCustomerData(projectId, customerId);
});
