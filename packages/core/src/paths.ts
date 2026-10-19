/**
 * Path builders for the Realtime Database and Storage layout described in
 * firebase/database.schema.md. Every builder validates its segments so a
 * malformed id can never escape its subtree.
 */
import { ClayverError } from "./errors.js";

export const ROOT = "clayver";
export const PROJECT_ID_PATTERN = /^[a-z0-9-]{1,40}$/;
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
/** Custom property keys. Keys starting with "_" are reserved for `UserProperty`. */
export const PROPERTY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Keys of user properties that the SDKs and the dashboard show specially, as
 * the customer's name, email and the host app's own user id. Values are strings.
 */
export const UserProperty = {
  name: "_name",
  email: "_email",
  uid: "_uid",
} as const;

/** Every `UserProperty` key. */
export const USER_PROPERTY_KEYS: readonly string[] = Object.values(UserProperty);

/** Characters that Realtime Database keys may not contain, plus "/". */
const FORBIDDEN_KEY_CHARS = /[.#$[\]/\u0000-\u001f\u007f]/;

export function isValidProjectId(projectId: string): boolean {
  return PROJECT_ID_PATTERN.test(projectId);
}

/** True when `key` is usable as a single database path segment. */
export function isValidKey(key: string): boolean {
  return (
    typeof key === "string" &&
    key.length > 0 &&
    key.length <= 768 &&
    !FORBIDDEN_KEY_CHARS.test(key)
  );
}

export function assertProjectId(projectId: string): string {
  if (!isValidProjectId(projectId)) {
    throw new ClayverError(
      "invalid-argument",
      `Invalid Clayver project id "${projectId}". Expected ^[a-z0-9-]{1,40}$.`,
    );
  }
  return projectId;
}

export function assertKey(key: string, what = "key"): string {
  if (!isValidKey(key)) {
    throw new ClayverError("invalid-argument", `Invalid ${what}: "${String(key)}".`);
  }
  return key;
}

export function assertDeviceId(deviceId: string): string {
  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    throw new ClayverError(
      "invalid-argument",
      `Invalid device id "${deviceId}". Expected ^[A-Za-z0-9_-]{8,64}$.`,
    );
  }
  return deviceId;
}

/** Path builders bound to one workspace. */
export interface ClayverPaths {
  readonly projectId: string;
  project(): string;
  conversations(): string;
  conversation(conversationId: string): string;
  messages(conversationId: string): string;
  message(conversationId: string, messageId: string): string;
  reads(conversationId: string): string;
  customerRead(conversationId: string): string;
  agentRead(conversationId: string): string;
  inbox(customerId: string): string;
  users(): string;
  user(customerId: string): string;
  agents(): string;
  agent(uid: string): string;
  agentSettings(uid: string): string;
  agentDevices(uid: string): string;
  agentDevice(uid: string, deviceId: string): string;
  customerDevice(customerId: string, deviceId: string): string;
  configPublic(): string;
  configPrivate(): string;
  rateLimits(): string;
  moderation(customerId: string): string;
  tags(): string;
  tag(tagId: string): string;
  conversationTags(conversationId: string): string;
  conversationTag(conversationId: string, tagId: string): string;
  tagIndex(tagId: string): string;
  notes(conversationId: string): string;
  note(conversationId: string, noteId: string): string;
  /** `triage/`: agent-only priority and stage of every conversation. */
  triageRoot(): string;
  triage(conversationId: string): string;
  /** `triageOptions/`: the workspace's priority and status lists. */
  triageOptions(): string;
  savedReplies(): string;
  savedReply(replyId: string): string;
  /** Storage folder for all attachments of one conversation. */
  storageConversationPrefix(customerId: string, conversationId: string): string;
  /** Full Storage object path of an attachment. */
  storageAttachment(
    customerId: string,
    conversationId: string,
    attachmentId: string,
    fileName: string,
  ): string;
}

export function createPaths(projectId: string): ClayverPaths {
  assertProjectId(projectId);
  const base = `${ROOT}/projects/${projectId}`;
  const k = assertKey;

  const paths: ClayverPaths = {
    projectId,
    project: () => base,
    conversations: () => `${base}/conversations`,
    conversation: (id) => `${base}/conversations/${k(id, "conversation id")}`,
    messages: (id) => `${base}/messages/${k(id, "conversation id")}`,
    message: (id, mid) =>
      `${base}/messages/${k(id, "conversation id")}/${k(mid, "message id")}`,
    reads: (id) => `${base}/reads/${k(id, "conversation id")}`,
    customerRead: (id) => `${base}/reads/${k(id, "conversation id")}/customer`,
    agentRead: (id) => `${base}/reads/${k(id, "conversation id")}/agent`,
    inbox: (cid) => `${base}/inbox/${k(cid, "customer id")}`,
    users: () => `${base}/users`,
    user: (cid) => `${base}/users/${k(cid, "customer id")}`,
    agents: () => `${base}/agents`,
    agent: (uid) => `${base}/agents/${k(uid, "uid")}`,
    agentSettings: (uid) => `${base}/agentSettings/${k(uid, "uid")}`,
    agentDevices: (uid) => `${base}/devices/agents/${k(uid, "uid")}`,
    agentDevice: (uid, deviceId) =>
      `${base}/devices/agents/${k(uid, "uid")}/${assertDeviceId(deviceId)}`,
    customerDevice: (cid, deviceId) =>
      `${base}/devices/customers/${k(cid, "customer id")}/${assertDeviceId(deviceId)}`,
    configPublic: () => `${base}/config/public`,
    configPrivate: () => `${base}/config/private`,
    rateLimits: () => `${base}/config/private/rateLimits`,
    moderation: (cid) => `${base}/moderation/${k(cid, "customer id")}`,
    tags: () => `${base}/tags`,
    tag: (tagId) => `${base}/tags/${k(tagId, "tag id")}`,
    conversationTags: (id) => `${base}/conversationTags/${k(id, "conversation id")}`,
    conversationTag: (id, tagId) =>
      `${base}/conversationTags/${k(id, "conversation id")}/${k(tagId, "tag id")}`,
    tagIndex: (tagId) => `${base}/tagIndex/${k(tagId, "tag id")}`,
    notes: (id) => `${base}/notes/${k(id, "conversation id")}`,
    note: (id, noteId) => `${base}/notes/${k(id, "conversation id")}/${k(noteId, "note id")}`,
    triageRoot: () => `${base}/triage`,
    triage: (id) => `${base}/triage/${k(id, "conversation id")}`,
    triageOptions: () => `${base}/triageOptions`,
    savedReplies: () => `${base}/savedReplies`,
    savedReply: (replyId) => `${base}/savedReplies/${k(replyId, "saved reply id")}`,
    storageConversationPrefix: (cid, id) =>
      `${base}/customers/${k(cid, "customer id")}/conversations/${k(id, "conversation id")}/`,
    storageAttachment: (cid, id, attachmentId, fileName) => {
      if (!fileName || fileName.length > 200 || fileName.includes("/")) {
        throw new ClayverError("invalid-argument", `Invalid attachment file name "${fileName}".`);
      }
      return `${paths.storageConversationPrefix(cid, id)}${k(attachmentId, "attachment id")}/${fileName}`;
    },
  };
  return paths;
}
