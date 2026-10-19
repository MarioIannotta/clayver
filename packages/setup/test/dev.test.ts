import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { androidOptions, androidPackage, dashboardEnvFile, findRepoRoot, flutterOptionsFile, iosOptions, setProperty } from "../src/commands/dev.js";

const PLIST = `<plist><dict>
  <key>API_KEY</key><string>ios-key</string>
  <key>GCM_SENDER_ID</key><string>123</string>
  <key>BUNDLE_ID</key><string>com.example.ios</string>
  <key>PROJECT_ID</key><string>demo-proj</string>
  <key>STORAGE_BUCKET</key><string>demo-proj.firebasestorage.app</string>
  <key>DATABASE_URL</key><string>https://demo-proj-default-rtdb.firebaseio.com</string>
  <key>GOOGLE_APP_ID</key><string>1:123:ios:abc</string>
</dict></plist>`;

const GOOGLE_SERVICES = JSON.stringify({
  project_info: { project_number: "123", project_id: "demo-proj", storage_bucket: "demo-proj.firebasestorage.app" },
  client: [
    { client_info: { mobilesdk_app_id: "1:123:android:other", android_client_info: { package_name: "com.other" } }, api_key: [{ current_key: "k1" }] },
    { client_info: { mobilesdk_app_id: "1:123:android:abc", android_client_info: { package_name: "com.example.android" } }, api_key: [{ current_key: "k2" }] },
  ],
});

describe("dev config files", () => {
  it("reads the native Firebase configs", () => {
    expect(iosOptions(PLIST)).toEqual({
      apiKey: "ios-key",
      appId: "1:123:ios:abc",
      messagingSenderId: "123",
      projectId: "demo-proj",
      storageBucket: "demo-proj.firebasestorage.app",
      databaseURL: "https://demo-proj-default-rtdb.firebaseio.com",
      iosBundleId: "com.example.ios",
    });
    expect(androidOptions(GOOGLE_SERVICES, "com.example.android")).toMatchObject({ apiKey: "k2", appId: "1:123:android:abc", messagingSenderId: "123" });
    expect(androidOptions("not json")).toBeUndefined();
    expect(androidPackage(GOOGLE_SERVICES, "1:123:android:abc")).toBe("com.example.android");
    expect(androidPackage(GOOGLE_SERVICES)).toBeUndefined();
  });

  it("writes firebase_options.dart for both platforms", () => {
    const dart = flutterOptionsFile(androidOptions(GOOGLE_SERVICES, "com.example.android"), iosOptions(PLIST));
    expect(dart).toContain("case TargetPlatform.android:");
    expect(dart).toContain("case TargetPlatform.iOS:");
    expect(dart).toContain("appId: '1:123:android:abc',");
    expect(dart).toContain("iosBundleId: 'com.example.ios',");
  });

  it("sets one property and keeps the rest of local.properties", () => {
    expect(setProperty("sdk.dir=/sdk\n", "clayver.applicationId", "a.b")).toBe("sdk.dir=/sdk\nclayver.applicationId=a.b\n");
    expect(setProperty("clayver.applicationId=old\nsdk.dir=/sdk\n", "clayver.applicationId", "a.b")).toBe("clayver.applicationId=a.b\nsdk.dir=/sdk\n");
    expect(setProperty(undefined, "k", "v")).toBe("k=v\n");
  });

  it("writes the dashboard env for the workspace and region", () => {
    const env = dashboardEnvFile({ apiKey: "web-key", projectId: "demo-proj", appId: "1:123:web:abc" }, { projectId: "demo-proj", workspace: "default", region: "us-central1" });
    expect(env).toContain("VITE_FIREBASE_API_KEY=web-key");
    expect(env).toContain("VITE_FIREBASE_AUTH_DOMAIN=demo-proj.firebaseapp.com");
    expect(env).toContain("VITE_CLAYVER_PROJECT_ID=default");
    expect(env).toContain("VITE_USE_EMULATORS=false");
  });

  it("finds the repository root from a subfolder", () => {
    const root = mkdtempSync(join(tmpdir(), "clayver-repo-"));
    mkdirSync(join(root, "firebase"));
    mkdirSync(join(root, "dashboard"));
    mkdirSync(join(root, "examples", "ios"), { recursive: true });
    writeFileSync(join(root, "firebase", "firebase.json"), "{}");
    writeFileSync(join(root, "dashboard", "package.json"), "{}");
    expect(findRepoRoot(join(root, "examples", "ios"))).toBe(root);
    expect(() => findRepoRoot(tmpdir())).toThrow(/Clayver repository/);
  });
});
