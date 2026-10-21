import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init.js";
import { runRemove } from "../src/commands/remove.js";
import { MissingAnswerError } from "../src/core/errors.js";
import { NonInteractivePrompter } from "../src/core/prompter.js";
import { copyFixture, FakeRunner, makeDeps, ScriptedPrompter, snapshot } from "./helpers/index.js";

describe("init per platform", () => {
  it("iOS: registers the app, writes GoogleService-Info.plist and Swift examples, leaves the Podfile alone (Swift Package Manager only)", async () => {
    const dir = copyFixture("ios");
    const original = snapshot(dir);
    const deps = makeDeps({ cwd: dir, prompter: new ScriptedPrompter([[/Which Firebase project/, "shop-prod"]], true), runner: new FakeRunner(undefined, ["firebase", "npm", "pod"]) });
    const { manifest } = await runInit({ admins: "admin@example.com", skipBackend: true }, deps);
    expect(deps.runner.find("apps:create", "IOS", "com.example.myapp")?.args).toContain("--bundle-id");
    expect(readFileSync(join(dir, "MyApp/GoogleService-Info.plist"), "utf8")).toContain("shop-prod");
    expect(readFileSync(join(dir, "Podfile"), "utf8")).not.toContain("ClayverSDK");
    expect(deps.logger.text()).toContain("Add Package Dependencies");
    expect(readFileSync(join(dir, "clayver-example/ios/ClayverSupportButton.swift"), "utf8")).toContain("ClayverChatView()");
    expect(manifest.steps.backend).toBe("skipped");
    expect(deps.runner.calls.some((c) => c.args[0] === "deploy")).toBe(false);

    await runRemove({}, makeDeps({ cwd: dir, prompter: new ScriptedPrompter([], true) }));
    expect(snapshot(dir)).toEqual(original);
  });

  it("Flutter: adds the pubspec dependency after confirmation and suggests flutterfire", async () => {
    const dir = copyFixture("flutter");
    const deps = makeDeps({ cwd: dir, prompter: new ScriptedPrompter([], true) });
    await runInit({ project: "shop-prod", admins: "admin@example.com", skipBackend: true, skipPush: true }, deps);
    expect(readFileSync(join(dir, "pubspec.yaml"), "utf8")).toContain("dependencies:\n  clayver: ^0.3.1\n  flutter:");
    expect(deps.logger.text()).toContain("flutterfire configure --project=shop-prod");
  });

  it("Flutter --yes does not edit pubspec.yaml (needs an explicit confirmation)", async () => {
    const dir = copyFixture("flutter");
    const before = readFileSync(join(dir, "pubspec.yaml"), "utf8");
    await runInit({ yes: true, project: "shop-prod", admins: "a@b.co", skipBackend: true }, makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) }));
    expect(readFileSync(join(dir, "pubspec.yaml"), "utf8")).toBe(before);
  });

  it("asks for the platform when detection fails, and --yes explains which flag to pass", async () => {
    const dir = copyFixture("unknown");
    await expect(runInit({ yes: true, project: "shop-prod" }, makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) }))).rejects.toThrow(MissingAnswerError);
    const deps = makeDeps({ cwd: dir, prompter: new ScriptedPrompter([[/Which platform/, "android"], [/package name/, "com.example.unknown"]], false) });
    const { manifest } = await runInit({ project: "shop-prod", skipBackend: true, skipExample: true, skipPush: true }, deps);
    expect(manifest.platform).toBe("android");
  });

  it("fails early with an actionable error when the Firebase CLI is missing or signed out", async () => {
    const dir = copyFixture("android");
    await expect(runInit({}, makeDeps({ cwd: dir, runner: new FakeRunner(undefined, ["npm"]) }))).rejects.toThrow(/Firebase CLI .* not installed/);
    const signedOut = new FakeRunner((s) => (s.args[0] === "login:list" ? { exitCode: 0, stdout: "No authorized accounts", stderr: "" } : undefined));
    await expect(runInit({}, makeDeps({ cwd: dir, runner: signedOut }))).rejects.toMatchObject({ hint: expect.stringContaining("firebase login") });
    await expect(runInit({}, makeDeps({ cwd: dir, nodeVersion: "18.19.0" }))).rejects.toThrow(/Node.js 20.17/);
  });
});
