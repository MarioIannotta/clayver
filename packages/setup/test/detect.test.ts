import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectApps, parseBundleIds } from "../src/detect/platform.js";
import { findFirebaseConfigs } from "../src/firebase/config-files.js";
import { FIXTURES } from "./helpers/index.js";

const app = (name: string) => join(FIXTURES, "apps", name);

describe("platform detection", () => {
  it("detects an iOS app from its .xcodeproj and Podfile", () => {
    const [ios, ...rest] = detectApps(app("ios"));
    expect(rest).toHaveLength(0);
    expect(ios?.platform).toBe("ios");
    expect(ios?.ios?.xcodeproj).toBe("MyApp.xcodeproj");
    expect(ios?.ios?.bundleId).toBe("com.example.myapp");
    expect(ios?.ios?.podfile).toBe("Podfile");
    expect(ios?.ios?.sourceDir).toBe("MyApp");
  });

  it("detects an Android app (Kotlin DSL) and its applicationId", () => {
    const [android] = detectApps(app("android"));
    expect(android?.platform).toBe("android");
    expect(android?.android).toMatchObject({
      module: "app",
      buildFile: "app/build.gradle.kts",
      kotlinDsl: true,
      applicationId: "com.example.shop",
      namespace: "com.example.shop",
      manifest: "app/src/main/AndroidManifest.xml",
    });
  });

  it("detects an Android app (Groovy DSL)", () => {
    const [android] = detectApps(app("android-bare"));
    expect(android?.android).toMatchObject({ buildFile: "app/build.gradle", kotlinDsl: false, applicationId: "com.example.bare" });
  });

  it("detects Flutter from pubspec.yaml and prefers it over the native folders", () => {
    const found = detectApps(app("flutter"));
    expect(found).toHaveLength(1);
    expect(found[0]?.platform).toBe("flutter");
    expect(found[0]?.flutter?.name).toBe("chatty");
    expect(found[0]?.flutter?.android?.applicationId).toBe("com.example.chatty");
    expect(found[0]?.flutter?.ios?.bundleId).toBe("com.example.chatty");
  });

  it("returns nothing for an unknown directory", () => {
    expect(detectApps(app("unknown"))).toEqual([]);
  });

  it("does not treat a Dart (non-Flutter) package as Flutter", () => {
    const dir = mkdtempSync(join(tmpdir(), "clayver-dart-"));
    writeFileSync(join(dir, "pubspec.yaml"), "name: cli_tool\ndependencies:\n  args: ^2.0.0\n");
    expect(detectApps(dir)).toEqual([]);
  });

  it("finds native apps in child folders when the root is not an app", () => {
    const dir = mkdtempSync(join(tmpdir(), "clayver-mono-"));
    mkdirSync(join(dir, "ios", "Shop.xcodeproj"), { recursive: true });
    mkdirSync(join(dir, "android", "app"), { recursive: true });
    writeFileSync(join(dir, "android", "settings.gradle"), "include ':app'\n");
    writeFileSync(join(dir, "android", "app", "build.gradle"), "apply plugin: 'com.android.application'\n");
    const found = detectApps(dir).map((a) => a.platform).sort();
    expect(found).toEqual(["android", "ios"]);
  });

  it("ignores test and variable bundle ids", () => {
    expect(parseBundleIds("PRODUCT_BUNDLE_IDENTIFIER = \"$(BASE).app\"; PRODUCT_BUNDLE_IDENTIFIER = a.b.cTests; PRODUCT_BUNDLE_IDENTIFIER = a.b.c;")).toEqual(["a.b.c"]);
  });
});

describe("Firebase config discovery", () => {
  it("reads the project id from google-services.json and .firebaserc", () => {
    const [android] = detectApps(app("android"));
    const configs = findFirebaseConfigs(android!);
    const kinds = configs.map((c) => `${c.kind}:${c.projectId}`).sort();
    expect(kinds).toEqual(["firebaserc:shop-prod", "google-services.json:shop-prod"]);
    expect(configs.find((c) => c.kind === "google-services.json")?.appIdentifiers).toEqual(["com.example.shop"]);
  });

  it("reads GoogleService-Info.plist and firebase_options.dart", () => {
    const dir = mkdtempSync(join(tmpdir(), "clayver-cfg-"));
    mkdirSync(join(dir, "lib"));
    mkdirSync(join(dir, "ios", "Runner"), { recursive: true });
    writeFileSync(join(dir, "pubspec.yaml"), "name: x\ndependencies:\n  flutter:\n    sdk: flutter\n");
    writeFileSync(join(dir, "lib", "firebase_options.dart"), "static const FirebaseOptions ios = FirebaseOptions(projectId: 'dart-proj', iosBundleId: 'com.x');");
    writeFileSync(
      join(dir, "ios", "Runner", "GoogleService-Info.plist"),
      "<plist><dict><key>BUNDLE_ID</key>\n<string>com.x</string><key>PROJECT_ID</key>\n<string>plist-proj</string></dict></plist>",
    );
    const [flutter] = detectApps(dir);
    const configs = findFirebaseConfigs(flutter!);
    expect(configs.map((c) => [c.kind, c.projectId])).toEqual(
      expect.arrayContaining([
        ["firebase_options.dart", "dart-proj"],
        ["GoogleService-Info.plist", "plist-proj"],
      ]),
    );
  });
});
