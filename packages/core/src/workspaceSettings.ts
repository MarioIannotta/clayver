/**
 * Workspace settings in `config/private` (agents read, admins write).
 */
import { onValue, ref, set } from "firebase/database";
import { httpsCallable } from "firebase/functions";
import type { ClayverClient } from "./client.js";
import { ClayverError, toClayverError } from "./errors.js";
import { CALLABLES, type AuthSettingsRequest, type AuthSettingsResponse, type PrivateConfig, type RateLimits, type Unsubscribe } from "./types.js";

/** What the functions apply when `config/private/rateLimits` is unset. */
export const DEFAULT_RATE_LIMITS: RateLimits = { messagesPerMinute: 30, conversationsPerHour: 10 };
export const MIN_RATE_LIMIT = 1;
export const MAX_RATE_LIMIT = 1000;

/** The limits in force: stored values, else the defaults, field by field. */
export function effectiveRateLimits(config: PrivateConfig | null | undefined): RateLimits {
  const stored = config?.rateLimits ?? {};
  const pick = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= MIN_RATE_LIMIT && v <= MAX_RATE_LIMIT ? v : fallback;
  return {
    messagesPerMinute: pick(stored.messagesPerMinute, DEFAULT_RATE_LIMITS.messagesPerMinute),
    conversationsPerHour: pick(stored.conversationsPerHour, DEFAULT_RATE_LIMITS.conversationsPerHour),
  };
}

/** Checks both limits are whole numbers in 1-1000; throws `invalid-argument` otherwise. */
export function validateRateLimits(limits: RateLimits): RateLimits {
  for (const [key, label] of [
    ["messagesPerMinute", "Messages per minute"],
    ["conversationsPerHour", "Conversations per hour"],
  ] as const) {
    const v = limits[key];
    if (!Number.isInteger(v) || v < MIN_RATE_LIMIT || v > MAX_RATE_LIMIT) {
      throw new ClayverError("invalid-argument", `${label} must be a whole number from ${MIN_RATE_LIMIT} to ${MAX_RATE_LIMIT}.`);
    }
  }
  return { messagesPerMinute: limits.messagesPerMinute, conversationsPerHour: limits.conversationsPerHour };
}

export function subscribePrivateConfig(
  client: ClayverClient,
  callback: (config: PrivateConfig) => void,
  onError?: (err: ClayverError) => void,
): Unsubscribe {
  return onValue(
    ref(client.db, client.paths.configPrivate()),
    (snap) => callback((snap.val() as PrivateConfig | null) ?? {}),
    (err) => onError?.(toClayverError(err)),
  );
}

/** Writes `config/private/rateLimits` (admins only). */
export async function setRateLimits(client: ClayverClient, limits: RateLimits): Promise<void> {
  const value = validateRateLimits(limits);
  try {
    await set(ref(client.db, client.paths.rateLimits()), value);
  } catch (err) {
    throw toClayverError(err);
  }
}

/**
 * Reads (no `anonymous`) or changes whether visitors may sign in anonymously.
 * A Firebase Auth setting: it applies to the whole Firebase project. Admins only.
 */
export async function anonymousSignIn(client: ClayverClient, anonymous?: boolean): Promise<boolean> {
  try {
    const call = httpsCallable<AuthSettingsRequest, AuthSettingsResponse>(client.functions, CALLABLES.authSettings);
    const res = await call({ projectId: client.projectId, ...(anonymous === undefined ? {} : { anonymous }) });
    return res.data.anonymous;
  } catch (err) {
    throw toClayverError(err);
  }
}
