import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init.js";
import { FileOps } from "../src/core/files.js";
import { sha256 } from "../src/core/hash.js";
import { MemoryLogger } from "../src/core/logger.js";
import { readManifest } from "../src/core/manifest.js";
import { NonInteractivePrompter, type Prompter } from "../src/core/prompter.js";
import { copyFixture, makeDeps, ScriptedPrompter, snapshot } from "./helpers/index.js";

function setup<P extends Prompter = ScriptedPrompter>(prompter: P = new ScriptedPrompter() as unknown as P, previous: { path: string; sha: string }[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "clayver-files-"));
  const logger = new MemoryLogger();
  const files = new FileOps({
    baseDir: dir,
    dryRun: false,
    prompter,
    logger,
    previous: previous.map((p) => ({ path: p.path, action: "created", kind: "example", description: "", sha256: p.sha })),
  });
  return { dir, files, logger, prompter };
}

describe("overwrite protection", () => {
  it("creates new files without asking and records them", async () => {
    const { dir, files, prompter } = setup();
    expect(await files.write({ path: join(dir, "a/b.txt"), content: "hi\n", kind: "example", description: "d" })).toBe("created");
    expect(readFileSync(join(dir, "a/b.txt"), "utf8")).toBe("hi\n");
    expect(prompter.asked).toEqual([]);
    expect(files.records.get("a/b.txt")).toMatchObject({ action: "created", sha256: sha256("hi\n") });
  });

  it("shows a diff and keeps the file when the developer declines", async () => {
    const { dir, files, logger, prompter } = setup(new ScriptedPrompter([[/Apply these changes/, false]]));
    writeFileSync(join(dir, "config.json"), '{ "mine": true }\n');
    const outcome = await files.write({ path: join(dir, "config.json"), content: '{ "theirs": true }\n', kind: "firebase-config", description: "d" });
    expect(outcome).toBe("skipped");
    expect(readFileSync(join(dir, "config.json"), "utf8")).toBe('{ "mine": true }\n');
    expect(prompter.asked).toEqual(["Apply these changes to config.json?"]);
    expect(logger.text()).toContain('-{ "mine": true }');
    expect(logger.text()).toContain('+{ "theirs": true }');
    expect(files.records.has("config.json")).toBe(false);
  });

  it("writes when the developer confirms and records the file as modified", async () => {
    const { dir, files } = setup(new ScriptedPrompter([[/Apply these changes/, true]]));
    writeFileSync(join(dir, "x.txt"), "old\n");
    expect(await files.write({ path: join(dir, "x.txt"), content: "new\n", kind: "example", description: "d" })).toBe("updated");
    expect(readFileSync(join(dir, "x.txt"), "utf8")).toBe("new\n");
    expect(files.records.get("x.txt")?.action).toBe("modified");
  });

  it("--yes never overwrites a changed file unless the change is marked safe", async () => {
    const { dir, files } = setup(new NonInteractivePrompter(true));
    writeFileSync(join(dir, "x.txt"), "old\n");
    expect(await files.write({ path: join(dir, "x.txt"), content: "new\n", kind: "example", description: "d" })).toBe("skipped");
    expect(readFileSync(join(dir, "x.txt"), "utf8")).toBe("old\n");
    expect(await files.write({ path: join(dir, "x.txt"), content: "old\nplus\n", kind: "example", description: "d", safe: true })).toBe("updated");
  });

  it("--yes updates a file Clayver created that nobody edited since", async () => {
    const { dir, files } = setup(new NonInteractivePrompter(true), [{ path: "gen.txt", sha: sha256("v1\n") }]);
    writeFileSync(join(dir, "gen.txt"), "v1\n");
    expect(await files.write({ path: join(dir, "gen.txt"), content: "v2\n", kind: "example", description: "d" })).toBe("updated");
    expect(files.records.get("gen.txt")?.action).toBe("created");
  });

  it("--yes keeps a file Clayver created once the developer edited it", async () => {
    const { dir, files } = setup(new NonInteractivePrompter(true), [{ path: "gen.txt", sha: sha256("v1\n") }]);
    writeFileSync(join(dir, "gen.txt"), "v1 + my edits\n");
    expect(await files.write({ path: join(dir, "gen.txt"), content: "v2\n", kind: "example", description: "d" })).toBe("skipped");
    expect(readFileSync(join(dir, "gen.txt"), "utf8")).toBe("v1 + my edits\n");
  });

  it("without a terminal and without --yes, asks nothing and fails with a hint", async () => {
    const { dir, files } = setup(new NonInteractivePrompter(false));
    writeFileSync(join(dir, "x.txt"), "old\n");
    await expect(files.write({ path: join(dir, "x.txt"), content: "new\n", kind: "example", description: "d" })).rejects.toThrow(/non-interactively/);
    expect(readFileSync(join(dir, "x.txt"), "utf8")).toBe("old\n");
  });

  it("re-running init --yes does not overwrite edited generated files or existing config", async () => {
    const dir = copyFixture("android");
    await runInit({ yes: true, admins: "admin@example.com" }, makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) }));
    const example = join(dir, "clayver-example/android/com/example/shop/clayver/ClayverSetup.kt");
    writeFileSync(example, "// customised\n");
    writeFileSync(join(dir, "clayver-functions/.env.shop-prod"), "CLAYVER_BOOTSTRAP_ADMINS=boss@example.com\nCLAYVER_FUNCTIONS_REGION=asia-east1\n");
    const before = snapshot(dir);
    const deps = makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) });
    await runInit({ yes: true }, deps);
    const after = snapshot(dir);
    expect(after["clayver-example/android/com/example/shop/clayver/ClayverSetup.kt"]).toBe("// customised\n");
    // The env file: existing values are reused as defaults, and the hand-edited file is not rewritten under --yes.
    expect(after["clayver-functions/.env.shop-prod"]).toBe(before["clayver-functions/.env.shop-prod"]);
    expect(after["database.rules.json"]).toBe(before["database.rules.json"]);
    expect(readManifest(dir)?.region).toBe("asia-east1");
  });
});

describe("identity", () => {
  it("sets up no secret: the generated example relies on Firebase Auth", async () => {
    const dir = copyFixture("flutter");
    const deps = makeDeps({ cwd: dir, prompter: new ScriptedPrompter([], true) });
    await runInit({ project: "shop-prod", admins: "admin@example.com" }, deps);
    expect(deps.runner.calls.some((c) => c.args[0]?.startsWith("functions:secrets"))).toBe(false);
    const example = readFileSync(join(dir, "clayver-example/flutter/clayver_support.dart"), "utf8");
    expect(example).toContain("FirebaseAuth");
    expect(example).not.toContain("userHash");
    expect(readdirSync(join(dir, "clayver-example/flutter"))).toEqual(["clayver_support.dart"]);
  });
});
