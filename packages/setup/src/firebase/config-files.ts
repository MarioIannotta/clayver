import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DetectedApp } from "../detect/platform.js";

export type ConfigKind = "firebaserc" | "google-services.json" | "GoogleService-Info.plist" | "firebase_options.dart";

export interface FoundConfig {
  kind: ConfigKind;
  /** Absolute path. */
  file: string;
  projectId?: string;
  /** Bundle id / package names the file was generated for. */
  appIdentifiers: string[];
  databaseURL?: string;
}

const SKIP_DIRS = new Set(["Pods", "build", "DerivedData", ".build", "node_modules", ".git", ".dart_tool", ".gradle", "clayver-example"]);

function findFiles(dir: string, name: string, depth: number, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (e === name) out.push(p);
    else if (depth > 0 && !SKIP_DIRS.has(e) && !e.startsWith(".")) {
      try {
        if (statSync(p).isDirectory()) findFiles(p, name, depth - 1, out);
      } catch {
        // unreadable, skip
      }
    }
  }
  return out;
}

export function parsePlist(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/<key>([^<]+)<\/key>\s*<(string|true|false)\s*\/?>([^<]*)/g)) {
    out[m[1] as string] = m[2] === "string" ? (m[3] ?? "") : String(m[2]);
  }
  return out;
}

export function readPlistConfig(file: string): FoundConfig {
  const p = parsePlist(readFileSync(file, "utf8"));
  return {
    kind: "GoogleService-Info.plist",
    file,
    projectId: p.PROJECT_ID,
    appIdentifiers: p.BUNDLE_ID ? [p.BUNDLE_ID] : [],
    databaseURL: p.DATABASE_URL,
  };
}

export function readGoogleServicesJson(file: string): FoundConfig {
  const json = JSON.parse(readFileSync(file, "utf8")) as {
    project_info?: { project_id?: string; firebase_url?: string };
    client?: { client_info?: { android_client_info?: { package_name?: string } } }[];
  };
  return {
    kind: "google-services.json",
    file,
    projectId: json.project_info?.project_id,
    databaseURL: json.project_info?.firebase_url,
    appIdentifiers: (json.client ?? [])
      .map((c) => c.client_info?.android_client_info?.package_name)
      .filter((x): x is string => !!x),
  };
}

export function readFirebaseOptionsDart(file: string): FoundConfig {
  const text = readFileSync(file, "utf8");
  const projectId = /projectId:\s*['"]([^'"]+)['"]/.exec(text)?.[1];
  const ids = [...text.matchAll(/(?:iosBundleId|androidPackageName):\s*['"]([^'"]+)['"]/g)].map((m) => m[1] as string);
  const databaseURL = /databaseURL:\s*['"]([^'"]+)['"]/.exec(text)?.[1];
  return { kind: "firebase_options.dart", file, projectId, appIdentifiers: ids, databaseURL };
}

export function readFirebaserc(file: string): FoundConfig {
  const json = JSON.parse(readFileSync(file, "utf8")) as { projects?: Record<string, string> };
  return { kind: "firebaserc", file, projectId: json.projects?.default, appIdentifiers: [] };
}

function safe(fn: () => FoundConfig): FoundConfig | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** Every Firebase config file in the app that names a project. */
export function findFirebaseConfigs(app: DetectedApp, firebaseDirs: string[] = []): FoundConfig[] {
  const found: FoundConfig[] = [];
  const push = (c: FoundConfig | undefined) => c && !found.some((f) => f.file === c.file) && found.push(c);
  for (const dir of [app.dir, dirname(app.dir), ...firebaseDirs]) {
    const rc = join(dir, ".firebaserc");
    if (existsSync(rc)) push(safe(() => readFirebaserc(rc)));
  }
  if (app.platform === "flutter") {
    const opts = join(app.dir, "lib", "firebase_options.dart");
    if (existsSync(opts)) push(safe(() => readFirebaseOptionsDart(opts)));
  }
  if (app.platform === "ios" || app.platform === "flutter") {
    const root = app.platform === "flutter" ? join(app.dir, "ios") : app.dir;
    for (const f of findFiles(root, "GoogleService-Info.plist", 4)) push(safe(() => readPlistConfig(f)));
  }
  if (app.platform === "android" || app.platform === "flutter") {
    const root = app.platform === "flutter" ? join(app.dir, "android") : app.dir;
    for (const f of findFiles(root, "google-services.json", 4)) push(safe(() => readGoogleServicesJson(f)));
  }
  return found;
}

/** Where the platform's Firebase config file is expected, relative to the app dir. */
export function expectedConfigPath(app: DetectedApp): { platform: "IOS" | "ANDROID"; path: string }[] {
  switch (app.platform) {
    case "ios": {
      const dir = app.ios?.sourceDir ?? ".";
      return [{ platform: "IOS", path: join(dir, "GoogleService-Info.plist") }];
    }
    case "android":
      return [{ platform: "ANDROID", path: join(app.android?.module ?? "app", "google-services.json") }];
    case "flutter":
      return [
        { platform: "ANDROID", path: "android/app/google-services.json" },
        { platform: "IOS", path: "ios/Runner/GoogleService-Info.plist" },
      ];
  }
}
