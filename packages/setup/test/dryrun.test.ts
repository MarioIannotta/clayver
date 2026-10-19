import { describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init.js";
import { runRemove } from "../src/commands/remove.js";
import { runUpdate } from "../src/commands/update.js";
import { NonInteractivePrompter } from "../src/core/prompter.js";
import { copyFixture, makeDeps, ScriptedPrompter, snapshot } from "./helpers/index.js";

describe("dry run", () => {
  it("init --dry-run writes no files and runs no mutating command", async () => {
    const dir = copyFixture("android");
    const before = snapshot(dir);
    const deps = makeDeps({ cwd: dir, prompter: new ScriptedPrompter([], true) });
    const result = await runInit({ dryRun: true, admins: "admin@example.com" }, deps);

    expect(snapshot(dir)).toEqual(before);
    expect(deps.runner.calls.length).toBeGreaterThan(0);
    expect(deps.runner.calls.filter((c) => c.mutating)).toEqual([]);
    expect(deps.runner.calls.some((c) => c.args[0] === "deploy")).toBe(false);
    expect(deps.runner.calls.some((c) => c.command === "npm")).toBe(false);

    const dry = deps.logger.entries.filter((e) => e.level === "dryRun").map((e) => e.message);
    expect(dry.some((m) => m.includes("would run: firebase deploy --only database,storage,functions:clayver --project shop-prod"))).toBe(true);
    expect(dry.some((m) => m.includes("would ask before modifying database.rules.json"))).toBe(true);
    expect(dry.some((m) => m.includes("would create clayver.json"))).toBe(true);
    // The plan still lists the files that would change.
    expect(result.manifest.files.map((f) => f.path)).toEqual(expect.arrayContaining(["database.rules.json", "storage.rules", "firebase.json"]));
  });

  it("init --dry-run --yes on an app without Firebase files does not register apps or write config", async () => {
    const dir = copyFixture("android-bare");
    const before = snapshot(dir);
    const deps = makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) });
    await runInit({ dryRun: true, yes: true, project: "shop-prod", admins: "a@b.co" }, deps);
    expect(snapshot(dir)).toEqual(before);
    expect(deps.runner.calls.filter((c) => c.mutating)).toEqual([]);
    expect(deps.logger.text()).toContain("would run: firebase apps:create ANDROID com.example.bare");
  });

  it("update and remove --dry-run leave an installed app untouched", async () => {
    const dir = copyFixture("android");
    await runInit({ yes: true, admins: "admin@example.com" }, makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) }));
    const installed = snapshot(dir);

    const up = makeDeps({ cwd: dir, prompter: new ScriptedPrompter([], true) });
    await runUpdate({ dryRun: true }, up);
    expect(snapshot(dir)).toEqual(installed);
    expect(up.runner.calls.filter((c) => c.mutating)).toEqual([]);

    const rm = makeDeps({ cwd: dir, prompter: new ScriptedPrompter([], true, "shop-prod") });
    await runRemove({ dryRun: true, deleteFunctions: true, deleteData: true }, rm);
    expect(snapshot(dir)).toEqual(installed);
    expect(rm.runner.calls.filter((c) => c.mutating)).toEqual([]);
    expect(rm.logger.text()).toContain("would run: firebase functions:delete clayver --project shop-prod --force");
  });
});
