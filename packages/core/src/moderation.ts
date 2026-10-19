/**
 * Customer blocks (`moderation/{customerId}`). While a block is active the
 * rules reject the customer's new conversations and messages.
 */
import { onValue, ref, remove, serverTimestamp, set } from "firebase/database";
import type { ClayverClient } from "./client.js";
import { ClayverError, toClayverError } from "./errors.js";
import type { BlockReason, ModerationRecord, Unsubscribe } from "./types.js";

/** Reasons an agent can pick. `rate_limit` is set only by the functions. */
export const MANUAL_BLOCK_REASONS = ["spam", "abuse", "other"] as const;
export type ManualBlockReason = (typeof MANUAL_BLOCK_REASONS)[number];

export const BLOCK_REASON_LABELS: Record<BlockReason, string> = {
  spam: "Spam",
  abuse: "Abuse",
  rate_limit: "Rate limit",
  other: "Other",
};

/** Durations offered in the UI; `null` is permanent (until an agent unblocks). */
export const BLOCK_DURATIONS: readonly { id: string; label: string; ms: number | null }[] = [
  { id: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { id: "24h", label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { id: "permanent", label: "Permanent", ms: null },
] as const;

/** A block is active when `blocked === true && (until == null || until > now)`. */
export function isBlockActive(block: Partial<ModerationRecord> | null | undefined, now = Date.now()): boolean {
  return !!block && block.blocked === true && (block.until == null || block.until > now);
}

/** The block if it is active at `now`, else null. */
export function activeBlock(block: ModerationRecord | null | undefined, now = Date.now()): ModerationRecord | null {
  return block && isBlockActive(block, now) ? block : null;
}

export function subscribeModeration(
  client: ClayverClient,
  customerId: string,
  callback: (block: ModerationRecord | null) => void,
  onError?: (err: ClayverError) => void,
): Unsubscribe {
  return onValue(
    ref(client.db, client.paths.moderation(customerId)),
    (snap) => callback((snap.val() as ModerationRecord | null) ?? null),
    (err) => onError?.(toClayverError(err)),
  );
}

export interface BlockCustomerInput {
  reason: ManualBlockReason;
  /** Milliseconds from now; `null` or omitted blocks until an agent unblocks. */
  durationMs?: number | null;
}

/** Builds the `moderation/{cid}` record (without the server timestamp). Exported for tests. */
export function buildBlockRecord(
  uid: string,
  input: BlockCustomerInput,
  serverNow: number,
): Omit<ModerationRecord, "at"> {
  if (!(MANUAL_BLOCK_REASONS as readonly string[]).includes(input.reason)) {
    throw new ClayverError("invalid-argument", `Invalid block reason "${String(input.reason)}".`);
  }
  const record: Omit<ModerationRecord, "at"> = { blocked: true, reason: input.reason, by: uid };
  if (input.durationMs != null) {
    if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
      throw new ClayverError("invalid-argument", "A block duration must be positive.");
    }
    record.until = Math.round(serverNow + input.durationMs);
  }
  return record;
}

/** The server's clock as seen by this client (`Date.now()` + `.info/serverTimeOffset`). */
export function serverNow(client: ClayverClient): Promise<number> {
  return new Promise((resolve) => {
    let unsubscribe: Unsubscribe | null = null;
    let done = false;
    const finish = (offset: number) => {
      if (done) return;
      done = true;
      unsubscribe?.();
      resolve(Date.now() + offset);
    };
    unsubscribe = onValue(
      ref(client.db, ".info/serverTimeOffset"),
      (snap) => finish(typeof snap.val() === "number" ? (snap.val() as number) : 0),
      () => finish(0),
    );
    if (done) unsubscribe();
  });
}

/** Blocks a customer as the signed-in agent, replacing any existing block. */
export async function blockCustomer(
  client: ClayverClient,
  customerId: string,
  input: BlockCustomerInput,
): Promise<void> {
  const uid = client.auth.currentUser?.uid;
  if (!uid) throw new ClayverError("unauthenticated", "You are signed out.");
  const record = buildBlockRecord(uid, input, input.durationMs != null ? await serverNow(client) : 0);
  try {
    await set(ref(client.db, client.paths.moderation(customerId)), { ...record, at: serverTimestamp() });
  } catch (err) {
    throw toClayverError(err);
  }
}

/** Removes the customer's block (manual or automatic). */
export async function unblockCustomer(client: ClayverClient, customerId: string): Promise<void> {
  try {
    await remove(ref(client.db, client.paths.moderation(customerId)));
  } catch (err) {
    throw toClayverError(err);
  }
}
