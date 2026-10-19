import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clayverSubtree, currentSubtreeHash, mergeDatabaseRules, removeDatabaseRules } from "../src/backend/database-rules.js";
import { planFirebaseJson, planFirebaserc, revertFirebaseJson } from "../src/backend/firebase-json.js";
import { clayverStorageBody, managedBlockHash, mergeStorageRules, removeStorageRules, STORAGE_BEGIN } from "../src/backend/storage-rules.js";
import { parseJsonc } from "../src/core/jsonedit.js";
import { ASSETS, FIXTURES } from "./helpers/index.js";

const assetRules = readFileSync(join(ASSETS, "database.rules.json"), "utf8");
const assetStorage = readFileSync(join(ASSETS, "storage.rules"), "utf8");
const existingRules = readFileSync(join(FIXTURES, "apps/android/database.rules.json"), "utf8");
const existingStorage = readFileSync(join(FIXTURES, "apps/android/storage.rules"), "utf8");

type Rules = { rules: Record<string, unknown> };

describe("database rules merge", () => {
  it("uses Clayver's file as is when none exists", () => {
    const r = mergeDatabaseRules(undefined, assetRules);
    expect(r.status).toBe("created");
    expect(r.content).toBe(assetRules);
  });

  it("adds the clayver subtree and preserves every existing rule, comment and byte", () => {
    const r = mergeDatabaseRules(existingRules, assetRules);
    expect(r.status).toBe("added");
    const merged = parseJsonc<Rules>(r.content, "merged");
    const before = parseJsonc<Rules>(existingRules, "before");
    expect(merged.rules.orders).toEqual(before.rules.orders);
    expect(merged.rules.catalog).toEqual(before.rules.catalog);
    expect(merged.rules.clayver).toEqual(clayverSubtree(assetRules));
    // Root .read/.write of the asset are NOT imposed on the host app.
    expect(merged.rules[".read"]).toBeUndefined();
    expect(r.content).toContain("// The shop's own rules: must survive Clayver's merge untouched.");
    // Everything before the insertion point is untouched.
    const prefix = existingRules.slice(0, existingRules.indexOf('"catalog": { ".read": true }') + 28);
    expect(r.content.startsWith(prefix)).toBe(true);
  });

  it("is idempotent", () => {
    const once = mergeDatabaseRules(existingRules, assetRules);
    const twice = mergeDatabaseRules(once.content, assetRules, once.subtreeHash);
    expect(twice.status).toBe("unchanged");
    expect(twice.content).toBe(once.content);
  });

  it("removing the subtree restores the original file exactly", () => {
    const merged = mergeDatabaseRules(existingRules, assetRules).content;
    expect(removeDatabaseRules(merged)).toBe(existingRules);
  });

  it("reports a conflict for a clayver subtree Clayver did not install", () => {
    const foreign = '{\n  "rules": {\n    "clayver": { ".read": true }\n  }\n}\n';
    const r = mergeDatabaseRules(foreign, assetRules);
    expect(r.status).toBe("conflict");
    expect(r.conflict).toMatch(/not installed by this Clayver setup/);
    expect(parseJsonc<Rules>(r.content, "x").rules.clayver).toEqual(clayverSubtree(assetRules));
  });

  it("reports a conflict when the installed subtree was edited by hand", () => {
    const installed = mergeDatabaseRules(existingRules, assetRules);
    const edited = installed.content.replace('"statusOrder"', '"statusOrder", "edited"');
    const newAsset = assetRules.replace("auth != null &&", "auth != null && true &&");
    const r = mergeDatabaseRules(edited, newAsset, installed.subtreeHash);
    expect(r.status).toBe("conflict");
    expect(r.conflict).toMatch(/edited after Clayver installed it/);
  });

  it("updates an unedited installed subtree without a conflict", () => {
    const installed = mergeDatabaseRules(existingRules, assetRules);
    const newAsset = assetRules.replace("auth != null &&", "auth != null && true &&");
    const r = mergeDatabaseRules(installed.content, newAsset, installed.subtreeHash);
    expect(r.status).toBe("updated");
    expect(currentSubtreeHash(r.content)).toBe(r.subtreeHash);
  });

  it("warns when a root rule cascades into clayver/", () => {
    const open = '{ "rules": { ".read": "auth != null", "x": {} } }';
    const r = mergeDatabaseRules(open, assetRules);
    expect(r.warnings.join("\n")).toMatch(/cascades into clayver/);
  });

  it("adds a rules object when the file has none", () => {
    const r = mergeDatabaseRules("{}\n", assetRules);
    expect(r.status).toBe("added");
    expect(Object.keys(parseJsonc<Rules>(r.content, "x").rules)).toEqual(["clayver"]);
  });

  it("refuses invalid JSON with a clear error", () => {
    expect(() => mergeDatabaseRules('{ "rules": ', assetRules)).toThrow(/not valid JSON/);
  });
});

describe("storage rules merge", () => {
  it("renames helper functions so they cannot collide with the app's", () => {
    const body = clayverStorageBody(assetStorage);
    expect(body).toContain("function clayver_signedIn()");
    expect(body).toContain("clayver_isAgent(projectId)");
    expect(body).not.toMatch(/[^_]isAgent\(/);
    expect(body).not.toContain("When merging into an existing");
  });

  it("inserts a marked block into the existing bucket match and keeps the app's rules", () => {
    const r = mergeStorageRules(existingStorage, assetStorage);
    expect(r.status).toBe("added");
    expect(r.content).toContain("match /avatars/{uid}/{file}");
    expect(r.content).toContain(STORAGE_BEGIN);
    expect(r.content.indexOf("match /avatars")).toBeLessThan(r.content.indexOf(STORAGE_BEGIN));
    expect(managedBlockHash(r.content)).toBe(r.blockHash);
  });

  it("round-trips: removing the block restores the original exactly", () => {
    const r = mergeStorageRules(existingStorage, assetStorage);
    expect(removeStorageRules(r.content)).toBe(existingStorage);
  });

  it("is idempotent and updates an unedited block", () => {
    const r = mergeStorageRules(existingStorage, assetStorage);
    expect(mergeStorageRules(r.content, assetStorage, r.blockHash).status).toBe("unchanged");
    const newer = assetStorage.replace("allow update, delete: if false;", "allow update, delete: if false; // v2");
    const u = mergeStorageRules(r.content, newer, r.blockHash);
    expect(u.status).toBe("updated");
    expect(u.content).toContain("// v2");
    expect(u.content).toContain("match /avatars/{uid}/{file}");
  });

  it("flags a hand-edited block as a conflict", () => {
    const r = mergeStorageRules(existingStorage, assetStorage);
    const edited = r.content.replace("allow update, delete: if false;", "allow update, delete: if true;");
    expect(mergeStorageRules(edited, assetStorage, r.blockHash).status).toBe("conflict");
  });

  it("creates a full file with the managed block when none exists", () => {
    const r = mergeStorageRules(undefined, assetStorage);
    expect(r.status).toBe("created");
    expect(r.content.startsWith("rules_version = '2';")).toBe(true);
    expect(r.content.match(/match \/clayver\/projects/g)).toHaveLength(1);
    expect(mergeStorageRules(r.content, assetStorage, r.blockHash).status).toBe("unchanged");
  });

  it("warns about recursive wildcards that would also grant access to clayver/", () => {
    const open = "rules_version = '2';\nservice firebase.storage {\n  match /b/{bucket}/o {\n    match /{allPaths=**} {\n      allow read, write: if request.auth != null;\n    }\n  }\n}\n";
    const r = mergeStorageRules(open, assetStorage);
    expect(r.warnings.join("\n")).toMatch(/recursive wildcard/);
  });

  it("asks for a manual merge when there is no bucket block", () => {
    expect(mergeStorageRules("service firebase.storage {}\n", assetStorage).status).toBe("manual");
  });
});

describe("firebase.json", () => {
  const existing = readFileSync(join(FIXTURES, "apps/android/firebase.json"), "utf8");

  it("keeps the app's single functions codebase and adds Clayver's as a second one", () => {
    const plan = planFirebaseJson(existing);
    const json = parseJsonc<{ functions: { source: string; codebase?: string }[]; hosting: unknown }>(plan.content, "x");
    expect(json.functions).toHaveLength(2);
    expect(json.functions[0]).toEqual({ source: "functions" });
    expect(json.functions[1]).toMatchObject({ source: "clayver-functions", codebase: "clayver", runtime: "nodejs22" });
    expect(json.hosting).toEqual({ public: "web", ignore: ["firebase.json"] });
    expect(plan.databaseRules).toBe("database.rules.json");
    expect(plan.reversal.functionsWasObject).toBe(true);
  });

  it("reverts to the original structure", () => {
    const plan = planFirebaseJson(existing);
    expect(parseJsonc(revertFirebaseJson(plan.content, plan.reversal), "x")).toEqual(parseJsonc(existing, "y"));
  });

  it("creates a complete config from scratch and reverts to empty", () => {
    const plan = planFirebaseJson(undefined, { hostingPublic: "clayver-dashboard" });
    const json = parseJsonc<Record<string, unknown>>(plan.content, "x");
    expect(Object.keys(json).sort()).toEqual(["database", "functions", "hosting", "storage"]);
    expect(plan.hostingAdded).toBe(true);
    expect(parseJsonc(revertFirebaseJson(plan.content, plan.reversal), "x")).toEqual({});
  });

  it("does not add the dashboard over an existing hosting config", () => {
    const plan = planFirebaseJson(existing, { hostingPublic: "clayver-dashboard" });
    expect(plan.hostingConflict).toBe(true);
    expect(plan.hostingAdded).toBe(false);
  });

  it("is idempotent", () => {
    const once = planFirebaseJson(existing).content;
    expect(planFirebaseJson(once).content).toBe(once);
  });

  it("leaves a different default project in .firebaserc alone", () => {
    const rc = '{ "projects": { "default": "other" } }';
    const plan = planFirebaserc(rc, "shop-prod");
    expect(plan.content).toBe(rc);
    expect(plan.warning).toMatch(/--project shop-prod/);
  });
});
