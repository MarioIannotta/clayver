import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Platform } from "../core/manifest.js";

export interface IosInfo {
  /** e.g. MyApp.xcodeproj (relative to the app dir). */
  xcodeproj?: string;
  projectName?: string;
  bundleId?: string;
  podfile?: string;
  /** Swift Package Manager manifest (Package.swift) at the root. */
  packageSwift?: string;
  /** Folder holding the app sources (usually next to the .xcodeproj, named after the project). */
  sourceDir?: string;
}

export interface AndroidInfo {
  /** Gradle module of the application, e.g. "app". */
  module: string;
  /** Build file of that module, relative to the app dir. */
  buildFile: string;
  kotlinDsl: boolean;
  applicationId?: string;
  namespace?: string;
  /** app/src/main/AndroidManifest.xml, relative, when present. */
  manifest?: string;
}

export interface FlutterInfo {
  name?: string;
  pubspec: string;
  android?: AndroidInfo;
  ios?: IosInfo;
}

export interface DetectedApp {
  platform: Platform;
  /** Absolute app directory. */
  dir: string;
  /** Human-readable reasons, e.g. "pubspec.yaml depends on the flutter sdk". */
  evidence: string[];
  ios?: IosInfo;
  android?: AndroidInfo;
  flutter?: FlutterInfo;
}

function read(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- Flutter

export function detectFlutter(dir: string): DetectedApp | undefined {
  const text = read(join(dir, "pubspec.yaml"));
  if (text === undefined) return undefined;
  let doc: Record<string, unknown> | null = null;
  try {
    doc = parseYaml(text) as Record<string, unknown> | null;
  } catch {
    return undefined;
  }
  const deps = (doc?.dependencies ?? {}) as Record<string, unknown>;
  const flutterDep = deps.flutter as { sdk?: string } | undefined;
  if (!flutterDep || flutterDep.sdk !== "flutter") return undefined;
  const flutter: FlutterInfo = { name: typeof doc?.name === "string" ? doc.name : undefined, pubspec: "pubspec.yaml" };
  const androidDir = join(dir, "android");
  const android = detectAndroid(androidDir);
  if (android?.android) {
    const a = android.android;
    flutter.android = { ...a, buildFile: `android/${a.buildFile}`, manifest: a.manifest ? `android/${a.manifest}` : undefined };
  }
  const ios = detectIos(join(dir, "ios"));
  if (ios?.ios) {
    const i = ios.ios;
    flutter.ios = {
      ...i,
      xcodeproj: i.xcodeproj ? `ios/${i.xcodeproj}` : undefined,
      podfile: i.podfile ? `ios/${i.podfile}` : undefined,
      sourceDir: i.sourceDir ? `ios/${i.sourceDir}` : undefined,
    };
  }
  return { platform: "flutter", dir, evidence: ["pubspec.yaml depends on the flutter sdk"], flutter };
}

// ---------------------------------------------------------------- Android

function gradleModules(settings: string): string[] {
  const modules: string[] = [];
  for (const m of settings.matchAll(/include\s*\(?([^)\n]+)\)?/g)) {
    for (const q of (m[1] ?? "").matchAll(/["']:?([\w.:-]+)["']/g)) {
      if (q[1]) modules.push(q[1].replace(/:/g, "/"));
    }
  }
  return modules;
}

const ANDROID_APP_PLUGIN = /com\.android\.application|android\.application|android-application|id\s*\(?\s*["']com\.android\.application/;

export function parseApplicationId(buildGradle: string): string | undefined {
  return /applicationId\s*(?:=\s*)?["']([\w.]+)["']/.exec(buildGradle)?.[1];
}

export function parseNamespace(buildGradle: string): string | undefined {
  return /namespace\s*(?:=\s*)?["']([\w.]+)["']/.exec(buildGradle)?.[1];
}

export function detectAndroid(dir: string): DetectedApp | undefined {
  const settingsName = ["settings.gradle.kts", "settings.gradle"].find((n) => existsSync(join(dir, n)));
  if (!settingsName) return undefined;
  const settings = read(join(dir, settingsName)) ?? "";
  const candidates = [...new Set([...gradleModules(settings), "app"])];
  for (const module of candidates) {
    for (const file of ["build.gradle.kts", "build.gradle"]) {
      const buildFile = `${module}/${file}`;
      const text = read(join(dir, buildFile));
      if (text === undefined) continue;
      if (!ANDROID_APP_PLUGIN.test(text) && !parseApplicationId(text)) continue;
      const manifest = `${module}/src/main/AndroidManifest.xml`;
      return {
        platform: "android",
        dir,
        evidence: [`${settingsName} + ${buildFile} (Android application module)`],
        android: {
          module,
          buildFile,
          kotlinDsl: file.endsWith(".kts"),
          applicationId: parseApplicationId(text),
          namespace: parseNamespace(text),
          manifest: existsSync(join(dir, manifest)) ? manifest : undefined,
        },
      };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------- iOS

export function parseBundleIds(pbxproj: string): string[] {
  const ids = new Map<string, number>();
  for (const m of pbxproj.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^";\n]+)"?\s*;/g)) {
    const id = (m[1] ?? "").trim();
    if (!id || id.includes("$") || /tests?$/i.test(id) || /\.(widget|extension|notification|share)/i.test(id)) continue;
    ids.set(id, (ids.get(id) ?? 0) + 1);
  }
  return [...ids.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).map(([id]) => id);
}

export function detectIos(dir: string): DetectedApp | undefined {
  const entries = list(dir);
  const xcodeproj = entries.find((e) => e.endsWith(".xcodeproj") && isDir(join(dir, e)) && !e.startsWith("Pods"));
  const workspace = entries.find((e) => e.endsWith(".xcworkspace"));
  const podfile = entries.includes("Podfile") ? "Podfile" : undefined;
  const packageSwift = entries.includes("Package.swift") ? "Package.swift" : undefined;
  if (!xcodeproj && !podfile && !packageSwift && !workspace) return undefined;
  const evidence: string[] = [];
  const ios: IosInfo = { podfile, packageSwift };
  if (xcodeproj) {
    evidence.push(xcodeproj);
    ios.xcodeproj = xcodeproj;
    ios.projectName = basename(xcodeproj, ".xcodeproj");
    const pbx = read(join(dir, xcodeproj, "project.pbxproj"));
    if (pbx) ios.bundleId = parseBundleIds(pbx)[0];
    if (isDir(join(dir, ios.projectName))) ios.sourceDir = ios.projectName;
  }
  if (workspace) evidence.push(workspace);
  if (podfile) evidence.push("Podfile");
  if (packageSwift) evidence.push("Package.swift");
  return { platform: "ios", dir, evidence, ios };
}

// ---------------------------------------------------------------- entry point

/**
 * Detects the app platform in `dir`. Flutter wins over the native folders it
 * contains. When nothing matches at the root, immediate children named like
 * app folders (ios/, android/, app/, mobile/ ...) are checked.
 */
export function detectApps(dir: string): DetectedApp[] {
  const atRoot = detectAt(dir);
  if (atRoot.length) return atRoot;
  const found: DetectedApp[] = [];
  for (const child of list(dir)) {
    if (child.startsWith(".") || child === "node_modules" || child === "build" || child === "Pods") continue;
    const p = join(dir, child);
    if (isDir(p)) found.push(...detectAt(p));
  }
  return found;
}

function detectAt(dir: string): DetectedApp[] {
  const flutter = detectFlutter(dir);
  if (flutter) return [flutter];
  return [detectIos(dir), detectAndroid(dir)].filter((d): d is DetectedApp => !!d);
}

/** Bundle id / application id of the detected app, whichever applies. */
export function appIdentifier(app: DetectedApp): { ios?: string; android?: string } {
  if (app.platform === "flutter") {
    return { ios: app.flutter?.ios?.bundleId, android: app.flutter?.android?.applicationId ?? app.flutter?.android?.namespace };
  }
  if (app.platform === "ios") return { ios: app.ios?.bundleId };
  return { android: app.android?.applicationId ?? app.android?.namespace };
}
