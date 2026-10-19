import {
  isClayverPushData,
  isWebPushSupported,
  registerAgentWebPush,
  unregisterAgentWebPush,
  type ClayverClient,
  type ClayverPushData,
} from "@clayver/core";

export const SW_URL = `${import.meta.env.BASE_URL}firebase-messaging-sw.js`;
/** Same scope Firebase uses by default, so the worker never controls app pages. */
export const SW_SCOPE = `${import.meta.env.BASE_URL}firebase-cloud-messaging-push-scope`;

export async function getPushRegistration(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) throw new Error("Service workers are not available.");
  const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (existing?.active) return existing;
  const reg = existing ?? (await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE }));
  await waitForActive(reg);
  return reg;
}

function waitForActive(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) return Promise.resolve();
  const worker = reg.installing ?? reg.waiting;
  if (!worker) return Promise.resolve();
  return new Promise((resolve) => {
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") resolve();
    });
  });
}

export async function enableWebPush(client: ClayverClient, vapidKey: string): Promise<void> {
  const serviceWorkerRegistration = await getPushRegistration();
  await registerAgentWebPush(client, { vapidKey, serviceWorkerRegistration });
}

export async function disableWebPush(client: ClayverClient): Promise<void> {
  await unregisterAgentWebPush(client);
}

export interface PushSupport {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
}

export async function getPushSupport(): Promise<PushSupport> {
  const supported =
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    (await isWebPushSupported());
  return { supported, permission: supported ? Notification.permission : "unsupported" };
}

export interface ForegroundPush {
  data: ClayverPushData;
  title?: string;
  body?: string;
}

/**
 * The service worker forwards pushes to visible dashboard tabs instead of
 * showing a system notification; this listens for those forwards.
 */
export function onForegroundPush(callback: (push: ForegroundPush) => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => undefined;
  const handler = (event: MessageEvent) => {
    const msg = event.data as { type?: string; data?: unknown; notification?: { title?: string; body?: string } } | null;
    if (msg?.type === "clayver-push" && isClayverPushData(msg.data)) {
      callback({ data: msg.data, title: msg.notification?.title, body: msg.notification?.body });
    }
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}
