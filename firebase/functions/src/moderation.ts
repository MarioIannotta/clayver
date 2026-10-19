import { db } from "./admin";
import { paths } from "./paths";

export const DEFAULT_RATE_LIMITS = { messagesPerMinute: 30, conversationsPerHour: 10 };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface Window {
  start: number;
  count: number;
}

/**
 * Fixed-window counter: counts in the current window, or starts a new one. Concurrent
 * invocations read slightly different clocks, so a `now` just before `start` still counts.
 */
export function bumpWindow(current: Window | null | undefined, now: number, windowMs: number): Window {
  if (!current || typeof current.start !== "number" || now - current.start >= windowMs) {
    return { start: now, count: 1 };
  }
  return { start: current.start, count: (current.count ?? 0) + 1 };
}

export interface Block {
  blocked: true;
  reason: "spam" | "abuse" | "rate_limit" | "other";
  until?: number;
  by: string;
  at: number;
}

export function isActiveBlock(b: Partial<Block> | null | undefined, now: number): boolean {
  return b?.blocked === true && (typeof b.until !== "number" || b.until > now);
}

async function rateLimits(projectId: string): Promise<typeof DEFAULT_RATE_LIMITS> {
  const configured = (await db().ref(`${paths.configPrivate(projectId)}/rateLimits`).get()).val() ?? {};
  return { ...DEFAULT_RATE_LIMITS, ...configured };
}

/** Blocks the customer until `until`. A manual block, or a longer automatic one, is never shortened. */
async function rateLimitBlock(projectId: string, customerId: string, until: number): Promise<void> {
  const now = Date.now();
  await db()
    .ref(paths.moderation(projectId, customerId))
    .transaction((current: Block | null) => {
      if (isActiveBlock(current, now) && (current!.reason !== "rate_limit" || (current!.until ?? Infinity) >= until)) {
        return undefined;
      }
      return { blocked: true, reason: "rate_limit", until, by: "system", at: now } satisfies Block;
    });
}

/** Counts one customer message; over `messagesPerMinute` blocks the customer for 10 minutes. */
export async function applyMessageRateLimit(projectId: string, customerId: string): Promise<boolean> {
  const { messagesPerMinute } = await rateLimits(projectId);
  const now = Date.now();
  const counter = await db()
    .ref(`${paths.limits(projectId, customerId)}/messages`)
    .transaction((current: Window | null) => bumpWindow(current, now, MINUTE));
  if (((counter.snapshot.val() as Window | null)?.count ?? 0) <= messagesPerMinute) return false;
  await rateLimitBlock(projectId, customerId, now + 10 * MINUTE);
  return true;
}

/**
 * Over `conversationsPerHour` conversations created in the last hour blocks the customer
 * for an hour. Counted from the inbox, so a retried trigger can't count twice.
 */
export async function applyConversationRateLimit(projectId: string, customerId: string): Promise<boolean> {
  const { conversationsPerHour } = await rateLimits(projectId);
  const now = Date.now();
  const inbox = ((await db().ref(`${paths.inbox(projectId, customerId)}/conversations`).get()).val() ?? {}) as Record<
    string,
    { createdAt?: number }
  >;
  const recent = Object.values(inbox).filter((e) => typeof e?.createdAt === "number" && now - e.createdAt < HOUR).length;
  if (recent <= conversationsPerHour) return false;
  await rateLimitBlock(projectId, customerId, now + HOUR);
  return true;
}

/** Removes blocks whose `until` has passed. */
export async function pruneExpiredBlocks(projectId: string): Promise<void> {
  const all = ((await db().ref(`${paths.project(projectId)}/moderation`).get()).val() ?? {}) as Record<string, Block>;
  const now = Date.now();
  const updates: Record<string, null> = {};
  for (const [cid, b] of Object.entries(all)) if (!isActiveBlock(b, now)) updates[cid] = null;
  if (Object.keys(updates).length) await db().ref(`${paths.project(projectId)}/moderation`).update(updates);
}
