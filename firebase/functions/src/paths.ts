import { db } from "./admin";

/** Path builders for the data model in firebase/database.schema.md. */
export const ROOT = "clayver/projects";
/** Server-only list of workspaces, so scheduled jobs can enumerate them cheaply. */
export const REGISTRY = "clayver/registry";

export const PROJECT_ID_RE = /^[a-z0-9-]{1,40}$/;

export const paths = {
  project: (p: string) => `${ROOT}/${p}`,
  conversation: (p: string, c: string) => `${ROOT}/${p}/conversations/${c}`,
  messages: (p: string, c: string) => `${ROOT}/${p}/messages/${c}`,
  reads: (p: string, c: string) => `${ROOT}/${p}/reads/${c}`,
  inbox: (p: string, cid: string) => `${ROOT}/${p}/inbox/${cid}`,
  user: (p: string, cid: string) => `${ROOT}/${p}/users/${cid}`,
  agents: (p: string) => `${ROOT}/${p}/agents`,
  agent: (p: string, uid: string) => `${ROOT}/${p}/agents/${uid}`,
  agentSettings: (p: string, uid: string) => `${ROOT}/${p}/agentSettings/${uid}`,
  devices: (p: string, ownerType: OwnerSegment, ownerId: string) =>
    `${ROOT}/${p}/devices/${ownerType}/${ownerId}`,
  tokenIndex: (p: string, tokenHash: string) => `${ROOT}/${p}/tokenIndex/${tokenHash}`,
  configPublic: (p: string) => `${ROOT}/${p}/config/public`,
  configPrivate: (p: string) => `${ROOT}/${p}/config/private`,
  notificationLog: (p: string, messageId: string) => `${ROOT}/${p}/notificationLog/${messageId}`,
  meta: (p: string) => `${ROOT}/${p}/meta`,
  tags: (p: string) => `${ROOT}/${p}/tags`,
  conversationTags: (p: string, c: string) => `${ROOT}/${p}/conversationTags/${c}`,
  tagIndexRoot: (p: string) => `${ROOT}/${p}/tagIndex`,
  tagIndex: (p: string, tag: string) => `${ROOT}/${p}/tagIndex/${tag}`,
  notes: (p: string, c: string) => `${ROOT}/${p}/notes/${c}`,
  triage: (p: string, c: string) => `${ROOT}/${p}/triage/${c}`,
  moderation: (p: string, cid: string) => `${ROOT}/${p}/moderation/${cid}`,
  limits: (p: string, cid: string) => `${ROOT}/${p}/limits/${cid}`,
};

export type OwnerSegment = "customers" | "agents";

export function statusOrder(status: string, updatedAt: number): string {
  return `${status}_${String(Math.max(0, Math.floor(updatedAt))).padStart(15, "0")}`;
}

export async function registerWorkspace(projectId: string): Promise<void> {
  await db().ref(`${REGISTRY}/${projectId}`).set(true);
}
