/**
 * Agent web push (FCM) registration and agent notification settings.
 *
 * Registration lives at `devices/agents/{uid}/{deviceId}`; the preference at
 * `agentSettings/{uid}/notifications/push`.
 */
import { onValue, ref, serverTimestamp, set, update } from "firebase/database";
import type { ClayverClient } from "./client.js";
import { ClayverError, toClayverError } from "./errors.js";
import { DEVICE_ID_PATTERN } from "./paths.js";
import type { AgentSettings, ClayverPushData, Unsubscribe } from "./types.js";

export const SDK_VERSION = "0.1.1";
const DEVICE_ID_STORAGE_KEY = "clayver.deviceId";
const DEVICE_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

/** Generates a random id matching `^[A-Za-z0-9_-]{8,64}$`. */
export function generateDeviceId(length = 22, random: (n: number) => Uint8Array = randomBytes): string {
  const n = Math.min(64, Math.max(8, length));
  const bytes = random(n);
  let id = "";
  for (let i = 0; i < n; i++) id += DEVICE_ID_ALPHABET[bytes[i]! & 63];
  return id;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(out);
  } else {
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Returns this browser's persistent device id, creating it on first use. */
export function getOrCreateDeviceId(storage?: KeyValueStorage | null): string {
  let store: KeyValueStorage | null | undefined = storage;
  if (store === undefined) {
    try {
      store = globalThis.localStorage;
    } catch {
      store = null;
    }
  }
  try {
    const existing = store?.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing && DEVICE_ID_PATTERN.test(existing)) return existing;
  } catch {
    /* storage unavailable */
  }
  const id = generateDeviceId();
  try {
    store?.setItem(DEVICE_ID_STORAGE_KEY, id);
  } catch {
    /* storage unavailable: the id lives for this page only */
  }
  return id;
}

/** True when `data` is a Clayver push `data` block. */
export function isClayverPushData(data: unknown): data is ClayverPushData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.clayver === "1" && typeof d.conversationId === "string" && d.conversationId.length > 0;
}

/** Dashboard route a push should open. */
export function dashboardPathForPush(data: unknown, basePath = "/"): string | null {
  if (!isClayverPushData(data)) return null;
  const base = basePath.endsWith("/") ? basePath : `${basePath}/`;
  return `${base}conversations/${encodeURIComponent(data.conversationId)}`;
}

/* ---- settings ---- */

export function subscribeAgentSettings(
  client: ClayverClient,
  uid: string,
  callback: (settings: AgentSettings) => void,
  onError?: (err: ClayverError) => void,
): Unsubscribe {
  return onValue(
    ref(client.db, client.paths.agentSettings(uid)),
    (snap) => callback((snap.val() as AgentSettings | null) ?? {}),
    (err) => onError?.(toClayverError(err)),
  );
}

export async function setAgentPushEnabled(client: ClayverClient, enabled: boolean): Promise<void> {
  const uid = requireUid(client);
  try {
    await set(ref(client.db, `${client.paths.agentSettings(uid)}/notifications/push`), enabled);
  } catch (err) {
    throw toClayverError(err);
  }
}

/* ---- web push ---- */

export interface WebPushOptions {
  /** Public VAPID key from Project settings > Cloud Messaging > Web Push certificates. */
  vapidKey: string;
  /** Registration of a service worker that handles `push` events. */
  serviceWorkerRegistration: ServiceWorkerRegistration;
  /** Defaults to `getOrCreateDeviceId()`. */
  deviceId?: string;
  appVersion?: string;
}

/** Whether this browser can receive FCM web push. */
export async function isWebPushSupported(): Promise<boolean> {
  try {
    const { isSupported } = await import("firebase/messaging");
    return await isSupported();
  } catch {
    return false;
  }
}

/**
 * Asks for notification permission (if needed), obtains an FCM token and
 * writes `devices/agents/{uid}/{deviceId}`. Returns the device id.
 */
export async function registerAgentWebPush(client: ClayverClient, options: WebPushOptions): Promise<string> {
  const uid = requireUid(client);
  if (!options.vapidKey) {
    throw new ClayverError("failed-precondition", "Web push is not configured (missing VAPID key).");
  }
  if (!(await isWebPushSupported())) {
    throw new ClayverError("unsupported", "This browser does not support web push notifications.");
  }
  if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new ClayverError(
        "permission-denied",
        permission === "denied"
          ? "Notifications are blocked for this site. Allow them in your browser settings."
          : "Notification permission was not granted.",
      );
    }
  }
  const deviceId = options.deviceId ?? getOrCreateDeviceId();
  try {
    const { getMessaging, getToken } = await import("firebase/messaging");
    const token = await getToken(getMessaging(client.app), {
      vapidKey: options.vapidKey,
      serviceWorkerRegistration: options.serviceWorkerRegistration,
    });
    if (!token) throw new ClayverError("unavailable", "Could not obtain a push token.");
    const registration: Record<string, unknown> = {
      uid,
      platform: "web",
      pushToken: token,
      active: true,
      updatedAt: serverTimestamp(),
      sdkVersion: `web-dashboard/${SDK_VERSION}`,
    };
    const locale = typeof navigator !== "undefined" ? navigator.language?.slice(0, 64) : undefined;
    if (locale) registration.locale = locale;
    if (options.appVersion) registration.appVersion = options.appVersion.slice(0, 64);
    await set(ref(client.db, client.paths.agentDevice(uid, deviceId)), registration);
    return deviceId;
  } catch (err) {
    throw toClayverError(err);
  }
}

/**
 * Marks this browser's registration inactive (opt-out) and deletes the FCM
 * token locally. Safe to call when nothing is registered.
 */
export async function unregisterAgentWebPush(client: ClayverClient, deviceId = getOrCreateDeviceId()): Promise<void> {
  const uid = requireUid(client);
  try {
    await update(ref(client.db, client.paths.agentDevice(uid, deviceId)), {
      active: false,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    const mapped = toClayverError(err);
    // Updating a missing registration fails validation; nothing to opt out of then.
    if (mapped.code !== "permission-denied") throw mapped;
  }
  try {
    if (await isWebPushSupported()) {
      const { getMessaging, deleteToken } = await import("firebase/messaging");
      await deleteToken(getMessaging(client.app));
    }
  } catch {
    /* token already gone */
  }
}

/** Foreground messages (when a dashboard tab is focused). */
export async function onForegroundPush(
  client: ClayverClient,
  callback: (data: ClayverPushData, notification?: { title?: string; body?: string }) => void,
): Promise<Unsubscribe> {
  if (!(await isWebPushSupported())) return () => undefined;
  const { getMessaging, onMessage } = await import("firebase/messaging");
  return onMessage(getMessaging(client.app), (payload) => {
    if (isClayverPushData(payload.data)) callback(payload.data, payload.notification);
  });
}

function requireUid(client: ClayverClient): string {
  const uid = client.auth.currentUser?.uid;
  if (!uid) throw new ClayverError("unauthenticated", "You are signed out.");
  return uid;
}
