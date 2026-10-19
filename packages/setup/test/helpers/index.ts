import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryLogger } from "../../src/core/logger.js";
import type { ConfirmQuestion, InputQuestion, Prompter, SelectQuestion, TypedConfirmation } from "../../src/core/prompter.js";
import type { CommandResult, CommandSpec, Runner } from "../../src/core/runner.js";
import type { Deps } from "../../src/core/context.js";

export const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
export const ASSETS = join(FIXTURES, "assets");

/** Copies a fixture app into a fresh temp directory. */
export function copyFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `clayver-${name}-`));
  cpSync(join(FIXTURES, "apps", name), dir, { recursive: true });
  return dir;
}

/** path → content of every file under dir. */
export function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p)] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

const ok = (stdout = ""): CommandResult => ({ exitCode: 0, stdout, stderr: "" });
const json = (result: unknown) => ok(JSON.stringify({ status: "success", result }));

export const PROJECTS = [
  { projectId: "shop-prod", displayName: "Shop" },
  { projectId: "other-proj", displayName: "Other" },
];

/** Default answers of a signed-in Firebase CLI. */
export function defaultFirebase(spec: CommandSpec): CommandResult | undefined {
  if (spec.command !== "firebase") return undefined;
  const [cmd, ...rest] = spec.args;
  switch (cmd) {
    case "--version":
      return ok("15.0.0\n");
    case "login:list":
      return ok("Logged in as dev@example.com\n");
    case "projects:list":
      return json(PROJECTS);
    case "apps:list":
      return json([]);
    case "apps:create":
      return json({ appId: `1:123:${String(rest[0]).toLowerCase()}:new` });
    case "apps:sdkconfig":
      if (rest[0] === "WEB") {
        // Older Firebase CLIs return the config as a JS snippet; parseWebSdkConfig handles both.
        return json({
          fileName: "google-config.js",
          fileContents:
            'firebase.initializeApp({\n  "projectId": "shop-prod",\n  "appId": "1:123:web:new",\n  "storageBucket": "shop-prod.firebasestorage.app",\n  "apiKey": "AIza-test-key",\n  "authDomain": "shop-prod.firebaseapp.com",\n  "messagingSenderId": "123"\n});\n',
        });
      }
      return json(
        rest[0] === "ANDROID"
          ? { fileName: "google-services.json", fileContents: '{\n  "project_info": { "project_id": "shop-prod" }\n}\n' }
          : { fileName: "GoogleService-Info.plist", fileContents: "<plist><dict><key>PROJECT_ID</key><string>shop-prod</string></dict></plist>\n" },
      );
    case "database:instances:list":
      return json([{ name: "shop-prod-default-rtdb", databaseUrl: "https://shop-prod-default-rtdb.firebaseio.com", type: "DEFAULT_DATABASE" }]);
    case "functions:list":
      return json([{ id: "clayverSetAgentRole", region: "us-central1", codebase: "clayver" }]);
    default:
      return ok();
  }
}

/** Records every command it receives and answers from `handler`. */
export class FakeRunner implements Runner {
  readonly calls: CommandSpec[] = [];
  constructor(
    private readonly handler: (spec: CommandSpec) => CommandResult | undefined = defaultFirebase,
    private readonly available: string[] = ["firebase", "npm"],
  ) {}
  async run(spec: CommandSpec): Promise<CommandResult> {
    this.calls.push(spec);
    return this.handler(spec) ?? defaultFirebase(spec) ?? ok();
  }
  async which(command: string) {
    return this.available.includes(command);
  }
  find(...args: string[]) {
    return this.calls.find((c) => args.every((a, i) => c.args[i] === a));
  }
}

type Answer = boolean | string | ((q: unknown) => unknown);

/**
 * Answers questions by matching their message against `answers` (first match
 * wins); otherwise takes the question's default (confirm: `fallbackConfirm`).
 */
export class ScriptedPrompter implements Prompter {
  readonly asked: string[] = [];
  constructor(
    private readonly answers: [RegExp, Answer][] = [],
    private readonly fallbackConfirm?: boolean,
    private readonly typedAnswer?: string,
  ) {}
  private find(message: string): Answer | undefined {
    this.asked.push(message);
    return this.answers.find(([re]) => re.test(message))?.[1];
  }
  async confirm(q: ConfirmQuestion) {
    const a = this.find(q.message);
    if (a !== undefined) return Boolean(typeof a === "function" ? a(q) : a);
    return this.fallbackConfirm ?? q.default ?? false;
  }
  async input(q: InputQuestion) {
    const a = this.find(q.message);
    const v = a !== undefined ? String(typeof a === "function" ? a(q) : a) : (q.default ?? "");
    if (q.validate && q.validate(v) !== true) throw new Error(`invalid scripted answer for ${q.message}: ${v}`);
    return v;
  }
  async select<T extends string>(q: SelectQuestion<T>) {
    const a = this.find(q.message);
    if (a !== undefined) return String(typeof a === "function" ? a(q) : a) as T;
    return (q.default ?? q.choices[0]?.value) as T;
  }
  async typed(q: TypedConfirmation) {
    this.asked.push(q.message);
    return this.typedAnswer === q.expected;
  }
}

export function makeDeps(over: Partial<Deps> & { cwd: string }): Deps & { logger: MemoryLogger; runner: FakeRunner } {
  return {
    runner: new FakeRunner(),
    prompter: new ScriptedPrompter(),
    logger: new MemoryLogger(),
    fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    assetsDir: ASSETS,
    nodeVersion: "20.18.0",
    color: false,
    now: () => new Date("2026-10-16T12:00:00.000Z"),
    ...over,
  } as Deps & { logger: MemoryLogger; runner: FakeRunner };
}
