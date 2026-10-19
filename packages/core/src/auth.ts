/**
 * Agent authentication and role resolution.
 *
 * A signed-in Firebase user is an agent of the workspace only when
 * `agents/{uid}` exists with `active === true`. That record (not the custom
 * claim) is the source of truth for the UI, exactly like the security rules.
 */
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  type User,
} from "firebase/auth";
import { onValue, ref } from "firebase/database";
import type { ClayverClient } from "./client.js";
import { toClayverError, type ClayverError } from "./errors.js";
import type { Agent, AgentRecord, AgentRole, Unsubscribe } from "./types.js";
import { ROLES_CLAIM } from "./types.js";

export type { User } from "firebase/auth";

export async function signInWithEmail(
  client: ClayverClient,
  email: string,
  password: string,
): Promise<User> {
  try {
    const cred = await signInWithEmailAndPassword(client.auth, email.trim(), password);
    return cred.user;
  } catch (err) {
    throw toClayverError(err);
  }
}

export async function signInWithGoogle(client: ClayverClient): Promise<User> {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const cred = await signInWithPopup(client.auth, provider);
    return cred.user;
  } catch (err) {
    throw toClayverError(err);
  }
}

export async function sendPasswordReset(client: ClayverClient, email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(client.auth, email.trim());
  } catch (err) {
    throw toClayverError(err);
  }
}

export async function signOut(client: ClayverClient): Promise<void> {
  try {
    await fbSignOut(client.auth);
  } catch (err) {
    throw toClayverError(err);
  }
}

export function subscribeAuthState(
  client: ClayverClient,
  callback: (user: User | null) => void,
): Unsubscribe {
  return onAuthStateChanged(client.auth, callback);
}

/**
 * Forces a fresh ID token so custom claims (`clayver_roles`) set by a callable
 * function are visible to Storage rules. No-op when signed out.
 */
export async function refreshIdToken(client: ClayverClient): Promise<void> {
  const user = client.auth.currentUser;
  if (user) await user.getIdToken(true);
}

/** The role in the current ID token's `clayver_roles` claim, if any. */
export async function getClaimRole(client: ClayverClient): Promise<AgentRole | null> {
  const user = client.auth.currentUser;
  if (!user) return null;
  const result = await user.getIdTokenResult();
  const roles = result.claims[ROLES_CLAIM] as Record<string, unknown> | undefined;
  const role = roles?.[client.projectId];
  return role === "admin" || role === "agent" ? role : null;
}

/** Effective role from an `agents/{uid}` record. */
export function effectiveRole(record: AgentRecord | null | undefined): AgentRole | null {
  if (!record || record.active !== true) return null;
  return record.role === "admin" || record.role === "agent" ? record.role : null;
}

export interface AgentRoleState {
  /** `agents/{uid}` as stored, or null when absent. */
  agent: Agent | null;
  /** `admin` / `agent` when active, else null ("not an agent"). */
  role: AgentRole | null;
}

/**
 * Subscribes to `agents/{uid}`. When the effective role changes (granted,
 * revoked, promoted), the ID token is refreshed so the `clayver_roles` claim
 * used by Storage rules catches up.
 */
export function subscribeAgentRole(
  client: ClayverClient,
  uid: string,
  callback: (state: AgentRoleState) => void,
  onError?: (err: ClayverError) => void,
): Unsubscribe {
  let lastRole: AgentRole | null | undefined;
  return onValue(
    ref(client.db, client.paths.agent(uid)),
    (snap) => {
      const record = snap.val() as AgentRecord | null;
      const agent = record ? { uid, ...record } : null;
      const role = effectiveRole(record);
      if (lastRole !== undefined && lastRole !== role && client.auth.currentUser?.uid === uid) {
        void refreshIdToken(client).catch(() => undefined);
      }
      lastRole = role;
      callback({ agent, role });
    },
    (err) => onError?.(toClayverError(err)),
  );
}

/** Display name used as `senderName` for an agent's replies. */
export function agentDisplayName(user: Pick<User, "displayName" | "email"> | null, agent?: AgentRecord | null): string {
  return (
    agent?.displayName?.trim() ||
    user?.displayName?.trim() ||
    agent?.email?.split("@")[0] ||
    user?.email?.split("@")[0] ||
    "Support"
  );
}
