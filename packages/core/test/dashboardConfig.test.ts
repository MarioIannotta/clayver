import { describe, expect, it } from "vitest";
import { pickFirebaseWebConfig, resolveDashboardConfig } from "../src/dashboardConfig.js";

const WEB = {
  apiKey: "AIza-test",
  authDomain: "shop.firebaseapp.com",
  databaseURL: "https://shop-default-rtdb.firebaseio.com",
  projectId: "shop",
  storageBucket: "shop.firebasestorage.app",
  messagingSenderId: "123",
  appId: "1:123:web:abc",
};

describe("dashboard runtime config", () => {
  it("prefers clayver.config.json", () => {
    const c = resolveDashboardConfig({
      file: { firebase: WEB, projectId: "support", functionsRegion: "europe-west1", vapidKey: "BK" },
      hosting: { ...WEB, apiKey: "other" },
      build: { firebase: { apiKey: "built" }, projectId: "built" },
    });
    expect(c.problems).toEqual([]);
    expect(c.source).toBe("clayver.config.json");
    expect(c.firebase.apiKey).toBe("AIza-test");
    expect(c.projectId).toBe("support");
    expect(c.functionsRegion).toBe("europe-west1");
    expect(c.vapidKey).toBe("BK");
  });

  it("falls back to Firebase Hosting's init.json with defaults", () => {
    const c = resolveDashboardConfig({ hosting: { ...WEB, locationId: "us-central" } });
    expect(c.source).toBe("firebase-hosting");
    expect(c.problems).toEqual([]);
    expect(c.projectId).toBe("default");
    expect(c.functionsRegion).toBe("us-central1");
    expect(c.firebase).not.toHaveProperty("locationId");
  });

  it("uses the file's workspace with the hosting web config when the file has no firebase block", () => {
    const c = resolveDashboardConfig({ file: { projectId: "team-b" }, hosting: WEB });
    expect(c.source).toBe("firebase-hosting");
    expect(c.projectId).toBe("team-b");
  });

  it("falls back to build-time values", () => {
    const c = resolveDashboardConfig({ build: { firebase: WEB, projectId: "dev" } });
    expect(c.source).toBe("build");
    expect(c.projectId).toBe("dev");
    expect(c.problems).toEqual([]);
  });

  it("explains what is missing", () => {
    expect(resolveDashboardConfig({}).problems[0]).toMatch(/No Firebase configuration found/);
    const partial = resolveDashboardConfig({ file: { firebase: { apiKey: "x" } } });
    expect(partial.problems).toContain("firebase.databaseURL is missing in clayver.config.json.");
    expect(resolveDashboardConfig({ hosting: { ...WEB, databaseURL: undefined } }).problems[0]).toMatch(/databaseURL is missing in \/__\/firebase\/init.json/);
    expect(resolveDashboardConfig({ file: { firebase: WEB, projectId: "Bad Id" } }).problems).toEqual([
      'projectId "Bad Id" must match ^[a-z0-9-]{1,40}$.',
    ]);
    expect(resolveDashboardConfig({ file: { firebase: WEB, functionsRegion: "mars" } }).problems[0]).toMatch(/functionsRegion/);
    expect(resolveDashboardConfig({ file: [] }).problems[0]).toMatch(/JSON object/);
    expect(resolveDashboardConfig({ fileError: "Unexpected token" }).problems[0]).toMatch(/could not be read: Unexpected token/);
  });

  it("needs only the project id against the emulators", () => {
    const c = resolveDashboardConfig({ file: { useEmulators: true } });
    expect(c.problems).toEqual([]);
    expect(c.firebase.projectId).toBe("demo-clayver");
    expect(c.useEmulators).toBe(true);
    expect(resolveDashboardConfig({ build: { useEmulators: true, firebase: { projectId: "demo-x" } } }).firebase.storageBucket).toBe("demo-x.appspot.com");
  });

  it("keeps only known, non-empty web config keys", () => {
    expect(pickFirebaseWebConfig({ apiKey: " k ", appId: "", foo: "bar", projectId: 3 })).toEqual({ apiKey: "k" });
    expect(pickFirebaseWebConfig(null)).toEqual({});
  });

  it("reads the optional App Check site key", () => {
    expect(resolveDashboardConfig({ file: { firebase: WEB } }).appCheck).toBeNull();
    const c = resolveDashboardConfig({ file: { firebase: WEB, appCheck: { recaptchaEnterpriseSiteKey: " 6Lc-key " } } });
    expect(c.problems).toEqual([]);
    expect(c.appCheck).toEqual({ recaptchaEnterpriseSiteKey: "6Lc-key" });
    expect(resolveDashboardConfig({ hosting: WEB, build: { appCheck: { recaptchaEnterpriseSiteKey: "built" } } }).appCheck).toEqual({
      recaptchaEnterpriseSiteKey: "built",
    });
    const bad = resolveDashboardConfig({ file: { firebase: WEB, appCheck: { siteKey: "x" } } });
    expect(bad.appCheck).toBeNull();
    expect(bad.problems.join(" ")).toMatch(/recaptchaEnterpriseSiteKey/);
  });
});
