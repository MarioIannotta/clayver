/*
 * Clayver dashboard push service worker.
 *
 * FCM web push delivers the message as a standard Push API event, so this
 * worker does not need the Firebase SDK or your Firebase config. It:
 *  - forwards Clayver pushes to a visible dashboard tab (shown as an in-app toast),
 *  - otherwise shows a system notification,
 *  - deep-links a notification click to /conversations/{conversationId}.
 *
 * Payload contract: firebase/database.schema.md, "Push notification payload".
 */
/* eslint-env serviceworker */

// The dashboard's base path, derived from where this file is served.
const BASE = new URL("./", self.location.href).pathname;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function parsePayload(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch {
    return null;
  }
}

function conversationUrl(data) {
  if (!data || data.clayver !== "1" || !data.conversationId) return BASE;
  return `${BASE}conversations/${encodeURIComponent(data.conversationId)}`;
}

self.addEventListener("push", (event) => {
  const payload = parsePayload(event);
  if (!payload) return;
  const data = payload.data || {};
  if (data.clayver !== "1") return;
  const notification = payload.notification || {};

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const visible = windows.filter(
        (c) => c.visibilityState === "visible" && new URL(c.url).pathname.startsWith(BASE),
      );
      if (visible.length > 0) {
        for (const client of visible) {
          client.postMessage({ type: "clayver-push", data, notification });
        }
        return;
      }
      await self.registration.showNotification(notification.title || "New message", {
        body: notification.body || "",
        icon: `${BASE}favicon.svg`,
        badge: `${BASE}favicon.svg`,
        tag: `clayver-${data.conversationId}`,
        renotify: true,
        data: { url: conversationUrl(data) },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || BASE, self.location.origin);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === target.origin && new URL(client.url).pathname.startsWith(BASE)) {
          // Dashboard tabs are not controlled by this worker (it has its own
          // scope), so ask the page's router to navigate without a reload.
          client.postMessage({ type: "clayver-navigate", url: target.pathname });
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
