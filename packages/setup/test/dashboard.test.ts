import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDashboardDeploy, runDashboardStart, type DashboardHandle } from "../src/commands/dashboard.js";
import { runInit } from "../src/commands/init.js";
import { runRemove } from "../src/commands/remove.js";
import { CLI_VERSION } from "../src/constants.js";
import { readManifest } from "../src/core/manifest.js";
import { NonInteractivePrompter } from "../src/core/prompter.js";
import { parseWebSdkConfig, planDashboardFirebaseJson } from "../src/dashboard/files.js";
import { createDashboardServer, listen } from "../src/dashboard/server.js";
import { ASSETS, copyFixture, defaultFirebase, FakeRunner, makeDeps, ScriptedPrompter, snapshot } from "./helpers/index.js";

const INDEX = "<!doctype html><title>Clayver</title><div id=root></div>";

/** A dashboard build: index.html, a hashed asset, an svg and a dotfile. */
function makeBuild(): string {
  const parent = mkdtempSync(join(tmpdir(), "clayver-dash-"));
  writeFileSync(join(parent, "secret.txt"), "TOP SECRET");
  const root = join(parent, "root");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "index.html"), INDEX);
  writeFileSync(join(root, "assets", "index-abc.js"), "console.log(1)");
  writeFileSync(join(root, "assets", "index-abc.css"), "body{}");
  writeFileSync(join(root, "favicon.svg"), "<svg/>");
  writeFileSync(join(root, "firebase-messaging-sw.js"), "self.x=1");
  writeFileSync(join(root, ".hidden"), "nope");
  return root;
}

/** Bundled assets (fixture backend) plus a dashboard build. */
function assetsWithDashboard(): string {
  const dir = mkdtempSync(join(tmpdir(), "clayver-assets-"));
  cpSync(ASSETS, dir, { recursive: true });
  cpSync(makeBuild(), join(dir, "dashboard"), { recursive: true });
  return dir;
}

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Sends the path exactly as given (no client-side normalisation of "..", unlike fetch). */
function get(port: number, path: string, method = "GET"): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method }, (res) => {
      let body = "";
      res.on("data", (d: Buffer) => (body += d.toString()));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

function track(server: Server) {
  servers.push({
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  });
}

async function serve(config?: string) {
  const root = makeBuild();
  const server = createDashboardServer({ root, readConfig: () => config });
  track(server);
  const port = await listen(server, 0, "127.0.0.1");
  return { port, root, server };
}

describe("dashboard static server", () => {
  it("serves files with the right content types and cache headers", async () => {
    const { port } = await serve('{"projectId":"default"}');
    const index = await get(port, "/");
    expect(index.status).toBe(200);
    expect(index.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(index.headers["cache-control"]).toBe("no-cache");
    expect(index.body).toBe(INDEX);
    const js = await get(port, "/assets/index-abc.js");
    expect(js.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(js.headers["cache-control"]).toContain("immutable");
    expect((await get(port, "/assets/index-abc.css")).headers["content-type"]).toBe("text/css; charset=utf-8");
    expect((await get(port, "/favicon.svg")).headers["content-type"]).toBe("image/svg+xml");
    expect((await get(port, "/firebase-messaging-sw.js")).headers["cache-control"]).toBe("no-cache");
    expect(index.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("falls back to index.html for client-side routes but not for missing assets", async () => {
    const { port } = await serve('{"projectId":"default"}');
    for (const path of ["/conversations/abc", "/team", "/conversations/-Nx_1?tab=open", "/settings/"]) {
      const r = await get(port, path);
      expect(r.status, path).toBe(200);
      expect(r.body, path).toBe(INDEX);
      expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
    }
    expect((await get(port, "/assets/missing-123.js")).status).toBe(404);
    expect((await get(port, "/__/firebase/init.json")).status).toBe(404);
    expect((await get(port, "/.hidden")).status).toBe(404);
  });

  it("serves the generated clayver.config.json", async () => {
    const { port } = await serve('{"firebase":{"apiKey":"k"},"projectId":"support"}\n');
    const r = await get(port, "/clayver.config.json");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(r.body)).toEqual({ firebase: { apiKey: "k" }, projectId: "support" });
    const none = await serve(undefined);
    expect((await get(none.port, "/clayver.config.json")).status).toBe(404);
  });

  it("blocks path traversal", async () => {
    const { port } = await serve('{"projectId":"default"}');
    for (const path of ["/../secret.txt", "/..%2fsecret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt", "/assets/..%5c..%5csecret.txt", "/%2e%2e%2f%2e%2e%2fsecret.txt"]) {
      const r = await get(port, path);
      expect(r.body, path).not.toContain("TOP SECRET");
      expect([400, 403, 404], path).toContain(r.status);
    }
    expect((await get(port, "/a%00b")).status).toBe(400);
    expect((await get(port, "/%E0%A4%A")).status).toBe(400);
  });

  it("answers HEAD without a body and rejects other methods", async () => {
    const { port } = await serve('{"projectId":"default"}');
    const head = await get(port, "/", "HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    expect(head.headers["content-length"]).toBe(String(INDEX.length));
    const post = await get(port, "/", "POST");
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
  });
});

describe("clayver dashboard start", () => {
  it("serves the bundled dashboard with the folder's clayver.config.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clayver-start-"));
    writeFileSync(join(dir, "clayver.config.json"), '{"firebase":{"apiKey":"k","databaseURL":"https://x"},"projectId":"default"}');
    const deps = makeDeps({ cwd: tmpdir(), assetsDir: assetsWithDashboard() });
    const handle: DashboardHandle = await runDashboardStart({ dir, port: "0" }, deps);
    servers.push({ close: () => handle.close() });
    const port = (handle.server.address() as AddressInfo).port;
    expect(handle.url).toBe(`http://localhost:${port}`);
    expect(JSON.parse((await get(port, "/clayver.config.json")).body).firebase.apiKey).toBe("k");
    expect((await get(port, "/conversations/abc")).body).toBe(INDEX);
    // Edits apply on the next request.
    writeFileSync(join(dir, "clayver.config.json"), '{"projectId":"edited"}');
    expect(JSON.parse((await get(port, "/clayver.config.json")).body).projectId).toBe("edited");
  });

  it("fails with a hint when the folder has no config, and works from an app with clayver.json", async () => {
    const empty = mkdtempSync(join(tmpdir(), "clayver-start-"));
    await expect(runDashboardStart({ dir: empty }, makeDeps({ cwd: empty, assetsDir: assetsWithDashboard() }))).rejects.toMatchObject({
      hint: expect.stringContaining("npx clayver init"),
    });

    const app = copyFixture("android");
    await runInit({ yes: true, admins: "admin@example.com", skipDashboard: true }, makeDeps({ cwd: app, prompter: new NonInteractivePrompter(true) }));
    // No clayver-dashboard/ folder: the config is read from the Firebase project (read-only commands).
    const runner = new FakeRunner((spec) =>
      spec.args[0] === "apps:list" && spec.args[1] === "WEB"
        ? { exitCode: 0, stdout: JSON.stringify({ status: "success", result: [{ appId: "1:123:web:new", displayName: "Clayver dashboard", platform: "WEB" }] }), stderr: "" }
        : defaultFirebase(spec),
    );
    const handle = await runDashboardStart({ port: 0 }, makeDeps({ cwd: app, runner, assetsDir: assetsWithDashboard() }));
    servers.push({ close: () => handle.close() });
    const cfg = JSON.parse((await get(handle.port, "/clayver.config.json")).body);
    expect(cfg.firebase).toMatchObject({ apiKey: "AIza-test-key", appId: "1:123:web:new", databaseURL: "https://shop-prod-default-rtdb.firebaseio.com" });
    expect(runner.calls.filter((c) => c.mutating)).toEqual([]);
  });
});

describe("init: agent dashboard step", () => {
  const DASH = ["clayver-dashboard/.gitignore", "clayver-dashboard/README.md", "clayver-dashboard/clayver.config.json", "clayver-dashboard/firebase.json", "clayver-dashboard/package.json"];

  it("dry run writes nothing and plans the web app registration", async () => {
    const dir = copyFixture("android");
    const before = snapshot(dir);
    const deps = makeDeps({ cwd: dir, prompter: new ScriptedPrompter([], true) });
    const result = await runInit({ dryRun: true, admins: "admin@example.com" }, deps);
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(join(dir, "clayver-dashboard"))).toBe(false);
    expect(deps.runner.calls.filter((c) => c.mutating)).toEqual([]);
    const text = deps.logger.text();
    expect(text).toContain('would run: firebase apps:create WEB \'Clayver dashboard\' --project shop-prod --json');
    expect(text).toContain("would create clayver-dashboard/clayver.config.json");
    expect(result.manifest.files.map((f) => f.path)).toEqual(expect.arrayContaining(DASH));
  });

  it("registers a web app, writes clayver-dashboard/ and records it in clayver.json", async () => {
    const dir = copyFixture("android");
    const deps = makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) });
    await runInit({ yes: true, admins: "admin@example.com", region: "europe-west1", workspace: "support" }, deps);
    expect(deps.runner.find("apps:list", "WEB")).toBeDefined();
    expect(deps.runner.find("apps:create", "WEB", "Clayver dashboard")).toBeDefined();
    expect(deps.runner.find("apps:sdkconfig", "WEB", "1:123:web:new")).toBeDefined();

    const m = readManifest(dir)!;
    expect(m.steps.dashboard).toBe("done");
    expect(m.dashboard).toEqual({ dir: "clayver-dashboard", webAppId: "1:123:web:new" });
    for (const p of DASH) expect(m.files.find((f) => f.path === p), p).toMatchObject({ action: "created", kind: "dashboard" });

    const cfg = JSON.parse(readFileSync(join(dir, "clayver-dashboard/clayver.config.json"), "utf8"));
    expect(cfg).toEqual({
      firebase: {
        apiKey: "AIza-test-key",
        authDomain: "shop-prod.firebaseapp.com",
        databaseURL: "https://shop-prod-default-rtdb.firebaseio.com",
        projectId: "shop-prod",
        storageBucket: "shop-prod.firebasestorage.app",
        messagingSenderId: "123",
        appId: "1:123:web:new",
      },
      projectId: "support",
      functionsRegion: "europe-west1",
      vapidKey: "",
    });
    const pkg = JSON.parse(readFileSync(join(dir, "clayver-dashboard/package.json"), "utf8"));
    expect(pkg.scripts).toEqual({ start: "clayver dashboard start --dir .", deploy: "clayver dashboard deploy --dir ." });
    expect(pkg.devDependencies).toEqual({ clayver: `^${CLI_VERSION}` });
    expect(JSON.parse(readFileSync(join(dir, "clayver-dashboard/firebase.json"), "utf8")).hosting.public).toBe("public");
    // The backend's firebase.json keeps its own hosting entry; the dashboard is not added to it.
    expect(JSON.parse(readFileSync(join(dir, "firebase.json"), "utf8").replace(/^\s*\/\/.*$/gm, "")).hosting.public).toBe("web");
  });

  it("reuses the web app on re-run and keeps the vapidKey the developer added", async () => {
    const dir = copyFixture("android");
    await runInit({ yes: true, admins: "admin@example.com" }, makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) }));
    const cfgPath = join(dir, "clayver-dashboard/clayver.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    writeFileSync(cfgPath, `${JSON.stringify({ ...cfg, vapidKey: "BKmine" }, null, 2)}\n`);
    const runner = new FakeRunner((spec) =>
      spec.args[0] === "apps:list" && spec.args[1] === "WEB"
        ? { exitCode: 0, stdout: JSON.stringify({ status: "success", result: [{ appId: "1:123:web:new", displayName: "Something else" }] }), stderr: "" }
        : undefined,
    );
    await runInit({ yes: true }, makeDeps({ cwd: dir, runner, prompter: new NonInteractivePrompter(true) }));
    expect(runner.find("apps:create", "WEB")).toBeUndefined();
    expect(JSON.parse(readFileSync(cfgPath, "utf8")).vapidKey).toBe("BKmine");
  });

  it("--skip-dashboard leaves it out", async () => {
    const dir = copyFixture("android");
    const deps = makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) });
    await runInit({ yes: true, admins: "admin@example.com", skipDashboard: true }, deps);
    expect(existsSync(join(dir, "clayver-dashboard"))).toBe(false);
    expect(readManifest(dir)?.steps.dashboard).toBe("skipped");
    expect(deps.runner.find("apps:list", "WEB")).toBeUndefined();
  });

  it("remove deletes the dashboard folder, including npm install and deploy output", async () => {
    const dir = copyFixture("android");
    const original = snapshot(dir);
    await runInit({ yes: true, admins: "admin@example.com" }, makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) }));
    mkdirSync(join(dir, "clayver-dashboard/node_modules/clayver"), { recursive: true });
    writeFileSync(join(dir, "clayver-dashboard/node_modules/clayver/x.js"), "");
    writeFileSync(join(dir, "clayver-dashboard/package-lock.json"), "{}");
    mkdirSync(join(dir, "clayver-dashboard/public"));
    writeFileSync(join(dir, "clayver-dashboard/public/index.html"), "x");
    const rm = makeDeps({ cwd: dir, prompter: new ScriptedPrompter([], true) });
    const r = await runRemove({}, rm);
    expect(r.kept).toEqual([]);
    expect(existsSync(join(dir, "clayver-dashboard"))).toBe(false);
    expect(Object.keys(snapshot(dir)).sort()).toEqual(Object.keys(original).sort());
    expect(rm.logger.text()).toContain("1:123:web:new stays registered");
  });
});

describe("clayver dashboard deploy", () => {
  it("fills public/, deploys hosting from the dashboard folder and records it", async () => {
    const dir = copyFixture("android");
    await runInit({ yes: true, admins: "admin@example.com" }, makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) }));
    const assetsDir = assetsWithDashboard();

    const dry = makeDeps({ cwd: dir, assetsDir, prompter: new NonInteractivePrompter(true) });
    const before = snapshot(dir);
    await runDashboardDeploy({ dryRun: true, yes: true }, dry);
    expect(snapshot(dir)).toEqual(before);
    expect(dry.logger.text()).toContain("would run: firebase deploy --only hosting --project shop-prod");

    const deps = makeDeps({ cwd: dir, assetsDir, prompter: new NonInteractivePrompter(true) });
    const r = await runDashboardDeploy({ yes: true }, deps);
    expect(r.status).toBe("done");
    expect(r.url).toBe("https://shop-prod.web.app");
    const call = deps.runner.find("deploy", "--only", "hosting", "--project", "shop-prod");
    expect(call?.cwd).toBe(join(dir, "clayver-dashboard"));
    expect(readFileSync(join(dir, "clayver-dashboard/public/index.html"), "utf8")).toBe(INDEX);
    expect(readFileSync(join(dir, "clayver-dashboard/public/clayver.config.json"), "utf8")).toBe(
      readFileSync(join(dir, "clayver-dashboard/clayver.config.json"), "utf8"),
    );
    expect(readManifest(dir)?.dashboard?.hosting).toMatchObject({ url: "https://shop-prod.web.app" });

    // remove still restores the app.
    await runRemove({}, makeDeps({ cwd: dir, prompter: new ScriptedPrompter([], true) }));
    expect(existsSync(join(dir, "clayver-dashboard"))).toBe(false);
  });

  it("does not replace a public/ folder Clayver did not create without asking", async () => {
    const dir = copyFixture("android");
    await runInit({ yes: true, admins: "admin@example.com" }, makeDeps({ cwd: dir, prompter: new NonInteractivePrompter(true) }));
    mkdirSync(join(dir, "clayver-dashboard/public"));
    writeFileSync(join(dir, "clayver-dashboard/public/mine.html"), "mine");
    await expect(runDashboardDeploy({ yes: true }, makeDeps({ cwd: dir, assetsDir: assetsWithDashboard(), prompter: new NonInteractivePrompter(true) }))).rejects.toThrow(/unchanged/);
    expect(readFileSync(join(dir, "clayver-dashboard/public/mine.html"), "utf8")).toBe("mine");
  });
});

describe("dashboard helpers", () => {
  it("parses every shape of apps:sdkconfig WEB", () => {
    const cfg = { apiKey: "k", appId: "a", projectId: "p" };
    expect(parseWebSdkConfig(cfg)).toEqual(cfg);
    expect(parseWebSdkConfig({ sdkConfig: { ...cfg, locationId: "x" } })).toEqual(cfg);
    expect(parseWebSdkConfig({ fileContents: 'firebase.initializeApp({ apiKey: "k", "appId": "a", projectId: "p" });' })).toEqual(cfg);
    expect(parseWebSdkConfig(undefined)).toBeUndefined();
  });

  it("merges the hosting target into the dashboard folder's firebase.json", () => {
    expect(JSON.parse(planDashboardFirebaseJson(undefined).content).hosting.public).toBe("public");
    const withSite = planDashboardFirebaseJson('{ "hosting": { "public": "public" } }', "my-support");
    expect(withSite.conflict).toBe(false);
    expect(JSON.parse(withSite.content).hosting.site).toBe("my-support");
    const other = planDashboardFirebaseJson('{ "hosting": { "public": "www" }, "emulators": {} }');
    expect(other.conflict).toBe(true);
    expect(JSON.parse(other.content)).toMatchObject({ hosting: { public: "public" }, emulators: {} });
  });
});
