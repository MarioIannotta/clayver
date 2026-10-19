/**
 * Team management: list agents, grant/revoke roles and bootstrap the first admin.
 * Role records are written only by Cloud Functions; clients call the callables.
 * The one exception is an agent's own display name.
 */
import { onValue, ref, set } from "firebase/database";
import { httpsCallable } from "firebase/functions";
import type { ClayverClient } from "./client.js";
import { ClayverError, toClayverError } from "./errors.js";
import { refreshIdToken } from "./auth.js";
import { isValidEmail } from "./validation.js";
import {
  CALLABLES,
  type Agent,
  type AgentRecord,
  type AgentRoleChange,
  type BootstrapAdminRequest,
  type BootstrapAdminResponse,
  type SetAgentRoleRequest,
  type SetAgentRoleResponse,
  type Unsubscribe,
} from "./types.js";

/** Converts the `agents` node into a list: admins first, then by name/email. */
export function snapshotToAgents(value: Record<string, AgentRecord> | null | undefined): Agent[] {
  if (!value) return [];
  const label = (a: Agent) => (a.displayName || a.email || a.uid).toLowerCase();
  return Object.entries(value)
    .map(([uid, a]) => ({ uid, ...a }))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
      return label(a).localeCompare(label(b));
    });
}

export function subscribeAgents(
  client: ClayverClient,
  callback: (agents: Agent[]) => void,
  onError?: (err: ClayverError) => void,
): Unsubscribe {
  return onValue(
    ref(client.db, client.paths.agents()),
    (snap) => callback(snapshotToAgents(snap.val() as Record<string, AgentRecord> | null)),
    (err) => onError?.(toClayverError(err)),
  );
}

export interface SetAgentRoleInput {
  email?: string;
  uid?: string;
  role: AgentRoleChange;
  displayName?: string;
}

/**
 * Builds the `clayverSetAgentRole` payload. Exactly one of `email` and `uid`
 * must be given. Exported for tests.
 */
export function buildSetAgentRoleRequest(projectId: string, input: SetAgentRoleInput): SetAgentRoleRequest {
  const email = input.email?.trim();
  const uid = input.uid?.trim();
  const given = [email, uid].filter(Boolean).length;
  if (given === 0) throw new ClayverError("invalid-argument", "Provide an email or a uid.");
  if (given > 1) throw new ClayverError("invalid-argument", "Provide only one of email or uid.");
  if (email && !isValidEmail(email)) {
    throw new ClayverError("invalid-argument", `"${email}" is not a valid email address.`);
  }
  if (!["admin", "agent", "none"].includes(input.role)) {
    throw new ClayverError("invalid-argument", `Invalid role "${input.role}".`);
  }
  const payload: SetAgentRoleRequest = { projectId, role: input.role };
  if (email) payload.email = email;
  if (uid) payload.uid = uid;
  const displayName = input.displayName?.trim();
  if (displayName) payload.displayName = displayName;
  return payload;
}

/**
 * Calls `clayverSetAgentRole`. Granting by email for an address without an
 * account creates one and returns an `inviteLink` (password-setup link) that
 * the admin shares with the new agent.
 */
export async function setAgentRole(
  client: ClayverClient,
  input: SetAgentRoleInput,
): Promise<SetAgentRoleResponse> {
  const payload = buildSetAgentRoleRequest(client.projectId, input);
  try {
    const fn = httpsCallable<SetAgentRoleRequest, SetAgentRoleResponse>(
      client.functions,
      CALLABLES.setAgentRole,
    );
    const { data } = await fn(payload);
    if (data.uid && data.uid === client.auth.currentUser?.uid) await refreshIdToken(client);
    return data;
  } catch (err) {
    throw toClayverError(err);
  }
}

export function revokeAgent(client: ClayverClient, uid: string): Promise<SetAgentRoleResponse> {
  return setAgentRole(client, { uid, role: "none" });
}

/**
 * Calls `clayverBootstrapAdmin` to make the signed-in user the first admin of
 * the workspace, then force-refreshes the ID token so the new
 * `clayver_roles` claim is active.
 */
export async function bootstrapAdmin(client: ClayverClient): Promise<BootstrapAdminResponse> {
  if (!client.auth.currentUser) throw new ClayverError("unauthenticated", "Sign in first.");
  try {
    const fn = httpsCallable<BootstrapAdminRequest, BootstrapAdminResponse>(
      client.functions,
      CALLABLES.bootstrapAdmin,
    );
    const { data } = await fn({ projectId: client.projectId });
    await refreshIdToken(client);
    return data;
  } catch (err) {
    throw toClayverError(err);
  }
}

/** Changes the signed-in agent's display name (shown to customers on their replies). */
export async function setMyDisplayName(client: ClayverClient, displayName: string): Promise<void> {
  const uid = client.auth.currentUser?.uid;
  if (!uid) throw new ClayverError("unauthenticated", "You are signed out.");
  const name = displayName.trim();
  if (name.length < 1 || name.length > 80) {
    throw new ClayverError("invalid-argument", "Display names are 1 to 80 characters.");
  }
  try {
    await set(ref(client.db, `${client.paths.agent(uid)}/displayName`), name);
  } catch (err) {
    throw toClayverError(err);
  }
}
