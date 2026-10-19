import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LINKS } from "../constants.js";
import type { DetectedApp } from "../detect/platform.js";
import type { DependencyEdit } from "../example/dependencies.js";

export const POST_NOTIFICATIONS_LINE = '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />';

export function postNotificationsEdit(manifestRel: string): DependencyEdit {
  return {
    file: manifestRel,
    lines: [POST_NOTIFICATIONS_LINE],
    apply(text) {
      if (text.includes("android.permission.POST_NOTIFICATIONS")) return undefined;
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      const lines = text.split(/\r?\n/);
      const start = lines.findIndex((l) => /<manifest[\s>]/.test(l));
      if (start < 0) return undefined;
      let end = start;
      while (end < lines.length && !lines[end]?.includes(">")) end++;
      if (end >= lines.length) return undefined;
      lines.splice(end + 1, 0, POST_NOTIFICATIONS_LINE);
      return lines.join(eol);
    },
  };
}

function findFiles(dir: string, test: (name: string) => boolean, depth = 3, out: string[] = []): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.startsWith(".") || e === "Pods" || e === "build" || e === "node_modules") continue;
    const p = join(dir, e);
    let isDir = false;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (test(e) && !isDir) out.push(p);
    else if (isDir && depth > 0 && !e.endsWith(".xcodeproj")) findFiles(p, test, depth - 1, out);
  }
  return out;
}

export interface IosPushStatus {
  pushEntitlement: boolean;
  remoteNotificationMode: boolean;
}

export function iosPushStatus(iosDir: string): IosPushStatus {
  const ents = findFiles(iosDir, (n) => n.endsWith(".entitlements"));
  const plists = findFiles(iosDir, (n) => n === "Info.plist");
  const read = (f: string) => {
    try {
      return readFileSync(f, "utf8");
    } catch {
      return "";
    }
  };
  return {
    pushEntitlement: ents.some((f) => read(f).includes("aps-environment")),
    remoteNotificationMode: plists.some((f) => read(f).includes("remote-notification")),
  };
}

function iosGuidance(projectId: string, status: IosPushStatus): string[] {
  return [
    "iOS push (APNs → FCM):",
    `  1. Create an APNs authentication key (.p8): ${LINKS.apnsKey}`,
    `  2. Upload it under Apple app configuration: ${LINKS.cloudMessaging(projectId)}`,
    `  3. Xcode > target > Signing & Capabilities: add "Push Notifications"${status.pushEntitlement ? " (found aps-environment ✓)" : " (not found yet)"}`,
    `  4. Add "Background Modes" and tick "Remote notifications"${status.remoteNotificationMode ? " (found ✓)" : " (not found yet)"}`,
    "  5. Forward the FCM token with Clayver.setFCMToken(_:) and taps with Clayver.handleNotification(userInfo:) (see the example).",
  ];
}

function androidGuidance(hasPermission: boolean, googleServicesPlugin: boolean): string[] {
  return [
    "Android push (FCM):",
    `  1. Apply the com.google.gms.google-services Gradle plugin${googleServicesPlugin ? " (found ✓)" : " (not found yet)"} and add firebase-messaging.`,
    `  2. Declare android.permission.POST_NOTIFICATIONS${hasPermission ? " (found ✓)" : " (missing)"} and request it at runtime on Android 13+.`,
    "  3. Register a FirebaseMessagingService that calls Clayver.setPushToken(token) and Clayver.handleNotification(context, data).",
  ];
}

export function hasGoogleServicesPlugin(appDir: string, buildFiles: string[]): boolean {
  return buildFiles.some((f) => {
    const p = join(appDir, f);
    return existsSync(p) && /google-services|googleServices|gms\.google/.test(readFileSync(p, "utf8"));
  });
}

export function pushGuidance(app: DetectedApp, projectId: string): string[] {
  const lines: string[] = [];
  const android = app.platform === "flutter" ? app.flutter?.android : app.android;
  const androidRoot = app.platform === "flutter" ? join(app.dir, "android") : app.dir;
  if (app.platform === "ios" || app.platform === "flutter") {
    const iosDir = app.platform === "flutter" ? join(app.dir, "ios") : app.dir;
    if (existsSync(iosDir)) lines.push(...iosGuidance(projectId, iosPushStatus(iosDir)));
  }
  if (android) {
    const manifest = android.manifest ? join(app.dir, android.manifest) : undefined;
    const has = !!manifest && existsSync(manifest) && readFileSync(manifest, "utf8").includes("POST_NOTIFICATIONS");
    const buildFiles = [android.buildFile, "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"].map((f) =>
      app.platform === "flutter" ? f.replace(/^android\//, "") : f,
    );
    lines.push(...androidGuidance(has, hasGoogleServicesPlugin(androidRoot, buildFiles)));
  }
  if (app.platform === "flutter") {
    lines.push("Flutter: add firebase_messaging and pass FirebaseMessaging.instance.getToken() to Clayver.setPushToken().");
  }
  lines.push("Clayver sends pushes from your Cloud Functions through FCM; no server key is needed.");
  return lines;
}
