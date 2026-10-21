import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init.js";
import { runRemove } from "../src/commands/remove.js";
import { runStatus } from "../src/commands/status.js";
import { runUpdate } from "../src/commands/update.js";
import { ClayverError } from "../src/core/errors.js";
import { parseManifest, readManifest, serializeManifest, type ClayverManifest } from "../src/core/manifest.js";
import { NonInteractivePrompter } from "../src/core/prompter.js";
import { sha256 } from "../src/core/hash.js";
import { copyFixture, makeDeps, ScriptedPrompter, snapshot } from "./helpers/index.js";

/** Says yes to every confirmation (dependency edits included). */
const yesToAll = (typed?: string) => new ScriptedPrompter([], true, typed);

describe("clayver.json", () => {
  it("serializes and parses back to the same object", () => {
    const m: ClayverManifest = {
      manifestVersion: 1,
      cliVersion: "0.1.0",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      platform: "ios",
      firebaseProjectId: "shop-prod",
      workspace: "default",
      region: "europe-west1",
      app: { bundleId: "com.example.myapp" },
      steps: { backend: "done", deploy: "failed" },
      files: [
        { path: "firebase.json", action: "modified", kind: "firebase-config", description: "x", sha256: "abc", reversal: { type: "firebase-json", addedPaths: [["storage"]], functionsCodebase: "clayver" } },
        { path: "Podfile", action: "modified", kind: "dependency", description: "y", sha256: "def", reversal: { type: "lines", lines: ["  pod 'ClayverSDK', '~> 0.1'"] } },
      ],
    };
    expect(parseManifest(serializeManifest(m))).toEqual(m);
  });

  it("rejects files that are not Clayver manifests", () => {
    expect(() => parseManifest('{"files": []}')).toThrow(ClayverError);
    expect(() => parseManifest("nope")).toThrow(/not valid JSON/);
    expect(() => parseManifest('{"manifestVersion":1,"files":[{"path":"a"}]}')).toThrow(/invalid file record/);
  });

  it("init records every created and modified file; remove restores the app exactly", async () => {
    const dir = copyFixture("android");
    const original = snapshot(dir);

    const init = makeDeps({ cwd: dir, prompter: yesToAll() });
    await runInit({ admins: "admin@example.com", region: "europe-west1" }, init);
    const m = readManifest(dir)!;
    const byPath = Object.fromEntries(m.files.map((f) => [f.path, f]));
    expect(byPath["firebase.json"]?.action).toBe("modified");
    expect(byPath["database.rules.json"]?.reversal).toEqual({ type: "json-remove", paths: [["rules", "clayver"]] });
    expect(byPath["storage.rules"]?.reversal).toEqual({ type: "storage-rules-block" });
    expect(byPath["app/build.gradle.kts"]?.reversal).toEqual({ type: "lines", lines: ['    implementation("com.clayver:clayver-android:0.3.1")'] });
    expect(byPath["app/src/main/AndroidManifest.xml"]?.kind).toBe("platform-config");
    expect(byPath["clayver-functions/package.json"]?.action).toBe("created");
    expect(byPath["clayver-functions/index.js"]?.action).toBe("created");
    expect(byPath["clayver-functions/lib/index.js"]).toBeUndefined();
    const fnPkg = JSON.parse(readFileSync(join(dir, "clayver-functions/package.json"), "utf8")) as {
      main: string;
      dependencies: Record<string, string>;
    };
    expect(fnPkg.main).toBe("index.js");
    expect(fnPkg.dependencies.clayver).toMatch(/^\^/);
    expect(fnPkg.dependencies["firebase-functions"]).toBeTruthy();
    expect(readFileSync(join(dir, "clayver-functions/index.js"), "utf8")).toContain('require("clayver/functions")');
    expect(byPath["clayver-functions/.env.shop-prod"]?.action).toBe("created");
    expect(m.region).toBe("europe-west1");
    expect(readFileSync(join(dir, "clayver-functions/.env.shop-prod"), "utf8")).toContain("CLAYVER_FUNCTIONS_REGION=europe-west1");
    expect(readFileSync(join(dir, "clayver-example/android/com/example/shop/clayver/ClayverSetup.kt"), "utf8")).toContain('functionsRegion = "europe-west1"');
    // Every recorded file exists with the recorded hash.
    const status = await runStatus({}, makeDeps({ cwd: dir }));
    expect(status.files.every((f) => f.state === "ok")).toBe(true);

    // Simulate npm install leftovers, then remove everything.
    writeFileSync(join(dir, "clayver-functions/package-lock.json"), "{}");
    const rm = makeDeps({ cwd: dir, prompter: yesToAll() });
    const result = await runRemove({}, rm);
    expect(result.kept).toEqual([]);
    expect(result.manifestDeleted).toBe(true);

    const after = snapshot(dir);
    expect(Object.keys(after).sort()).toEqual(Object.keys(original).sort());
    for (const [path, content] of Object.entries(original)) {
      if (path === "firebase.json") expect(JSON.parse(after[path]!)).toEqual(JSON.parse(content));
      else expect(after[path], path).toBe(content);
    }
    expect(existsSync(join(dir, "clayver-functions"))).toBe(false);
    expect(existsSync(join(dir, "clayver-example"))).toBe(false);
    // Functions were deleted on request; data was not touched (typed confirmation did not match).
    expect(rm.runner.find("functions:delete", "clayver")).toBeDefined();
    expect(rm.runner.find("database:remove")).toBeUndefined();
  });

  it("remove deletes data only after the project id is typed", async () => {
    const dir = copyFixture("android");
    await runInit({ admins: "admin@example.com" }, makeDeps({ cwd: dir, prompter: yesToAll() }));
    const rm = makeDeps({ cwd: dir, prompter: yesToAll("shop-prod") });
    await runRemove({}, rm);
    expect(rm.runner.find("database:remove", "/clayver", "--project", "shop-prod")).toBeDefined();
  });

  it("remove --yes never deletes functions or data", async () => {
    const dir = copyFixture("android");
    await runInit({ yes: true, admins: "admin@example.com" }, makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) }));
    const rm = makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) });
    await runRemove({ yes: true }, rm);
    expect(rm.runner.calls.filter((c) => c.mutating)).toEqual([]);
  });

  it("remove keeps Clayver-created files the developer edited when not confirmed, and keeps their records", async () => {
    const dir = copyFixture("android");
    await runInit({ yes: true, admins: "admin@example.com" }, makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) }));
    const edited = join(dir, "clayver-example/android/com/example/shop/clayver/ClayverSetup.kt");
    writeFileSync(edited, "// my changes\n");
    const result = await runRemove({ yes: true }, makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) }));
    expect(result.kept).toEqual(["clayver-example/android/com/example/shop/clayver/ClayverSetup.kt"]);
    expect(readFileSync(edited, "utf8")).toBe("// my changes\n");
    expect(readManifest(dir)?.files.map((f) => f.path)).toEqual(["clayver-example/android/com/example/shop/clayver/ClayverSetup.kt"]);
  });

  it("remove undoes only Clayver's part of a file the developer changed later", async () => {
    const dir = copyFixture("android");
    await runInit({ yes: true, admins: "admin@example.com" }, makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) }));
    const rulesPath = join(dir, "database.rules.json");
    writeFileSync(rulesPath, readFileSync(rulesPath, "utf8").replace('"catalog": { ".read": true }', '"catalog": { ".read": true },\n    "news": { ".read": true }'));
    await runRemove({}, makeDeps({ cwd: dir, prompter: yesToAll() }));
    const rules = JSON.parse(readFileSync(rulesPath, "utf8").replace(/^\s*\/\/.*$/gm, ""));
    expect(Object.keys(rules.rules)).toEqual(["orders", "catalog", "news"]);
  });

  it("init on a bare app creates firebase.json and rules; remove deletes them again", async () => {
    const dir = copyFixture("android-bare");
    const original = snapshot(dir);
    const init = makeDeps({ cwd: dir, prompter: yesToAll() });
    await runInit({ project: "shop-prod", admins: "admin@example.com" }, init);
    expect(init.runner.find("apps:create", "ANDROID")).toBeDefined();
    expect(readFileSync(join(dir, "app/google-services.json"), "utf8")).toContain("shop-prod");
    const m = readManifest(dir)!;
    expect(m.files.find((f) => f.path === "firebase.json")?.action).toBe("created");
    expect(m.files.find((f) => f.path === "database.rules.json")?.action).toBe("created");
    expect(m.app.firebaseAppId).toBe("1:123:android:new");

    await runRemove({}, makeDeps({ cwd: dir, prompter: yesToAll() }));
    expect(snapshot(dir)).toEqual(original);
  });

  it("update removes function source copied by an older CLI and redeploys", async () => {
    const dir = copyFixture("android");
    await runInit({ yes: true, admins: "admin@example.com" }, makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) }));
    // An older CLI had copied the compiled functions into the app.
    const m = readManifest(dir)!;
    mkdirSync(join(dir, "clayver-functions/lib"), { recursive: true });
    writeFileSync(join(dir, "clayver-functions/lib/index.js"), "exports.clayverSetAgentRole = () => 'v1';\n");
    writeFileSync(join(dir, "clayver-functions/lib/old.js"), "old");
    m.files.push(
      { path: "clayver-functions/lib/index.js", action: "created", kind: "functions", description: "compiled", sha256: sha256("exports.clayverSetAgentRole = () => 'v1';\n") },
      { path: "clayver-functions/lib/old.js", action: "created", kind: "functions", description: "old", sha256: sha256("old") },
    );
    writeFileSync(join(dir, "clayver.json"), serializeManifest(m));

    const before = await runStatus({}, makeDeps({ cwd: dir }));
    expect(before.updateAvailable).toBe(false);

    const up = makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) });
    await runUpdate({ yes: true }, up);
    expect(existsSync(join(dir, "clayver-functions/lib/index.js"))).toBe(false);
    expect(existsSync(join(dir, "clayver-functions/lib/old.js"))).toBe(false);
    expect(existsSync(join(dir, "clayver-functions/lib"))).toBe(false);
    expect(readFileSync(join(dir, "clayver-functions/index.js"), "utf8")).toContain('require("clayver/functions")');
    expect(up.runner.find("deploy", "--only", "database,storage,functions:clayver")).toBeDefined();
    const after = readManifest(dir)!;
    expect(after.files.some((f) => f.path.startsWith("clayver-functions/lib/"))).toBe(false);
  });

  it("update does not overwrite a hand-edited functions entry under --yes", async () => {
    const dir = copyFixture("android");
    await runInit({ yes: true, admins: "admin@example.com" }, makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) }));
    writeFileSync(join(dir, "clayver-functions/index.js"), "// patched by hand\n");
    await runUpdate({ yes: true, deploy: false }, makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) }));
    expect(readFileSync(join(dir, "clayver-functions/index.js"), "utf8")).toBe("// patched by hand\n");
  });
});
