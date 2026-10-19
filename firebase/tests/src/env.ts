import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { getApps as getAdminApps, initializeApp as initAdmin, type App as AdminApp } from "firebase-admin/app";
import { getDatabase as getAdminDb } from "firebase-admin/database";
import { getAuth as getAdminAuth } from "firebase-admin/auth";

export const PROJECT = "demo-clayver";
// The emulator names the default instance after the project id (production: `<id>-default-rtdb`).
export const NS = PROJECT;
export const WS = "default"; // Clayver workspace id
export const BASE = `clayver/projects/${WS}`;

const host = (name: string, fallback: string) => process.env[name] ?? fallback;
export const DB_HOST = host("FIREBASE_DATABASE_EMULATOR_HOST", "127.0.0.1:9000");
export const AUTH_HOST = host("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099");
export const STORAGE_HOST = host("FIREBASE_STORAGE_EMULATOR_HOST", "127.0.0.1:9199");
export const FUNCTIONS_HOST = host("CLAYVER_FUNCTIONS_EMULATOR_HOST", "127.0.0.1:5001");

const rulesPath = (f: string) => fileURLToPath(new URL(`../../${f}`, import.meta.url));

let env: RulesTestEnvironment | undefined;

export async function testEnv(): Promise<RulesTestEnvironment> {
  if (env) return env;
  const [dbHost, dbPort] = DB_HOST.split(":");
  const [stHost, stPort] = STORAGE_HOST.split(":");
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    database: { host: dbHost, port: Number(dbPort), rules: readFileSync(rulesPath("database.rules.json"), "utf8") },
    storage: { host: stHost, port: Number(stPort), rules: readFileSync(rulesPath("storage.rules"), "utf8") },
  });
  return env;
}

/** Admin SDK pointed at the emulators (bypasses rules, like Cloud Functions). */
export function admin(): AdminApp {
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = DB_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  return (
    getAdminApps()[0] ??
    initAdmin({ projectId: PROJECT, databaseURL: `http://${DB_HOST}?ns=${NS}` })
  );
}
export const adminDb = () => getAdminDb(admin());
export const adminAuth = () => getAdminAuth(admin());

/** Polls until `check` returns a truthy value or the timeout elapses. */
export async function eventually<T>(check: () => Promise<T | undefined | null | false>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await check();
      if (v) return v as T;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`condition not met within ${timeoutMs}ms${last ? `: ${String(last)}` : ""}`);
}

export async function resetData(): Promise<void> {
  await adminDb().ref("/").set(null);
  const [h, p] = AUTH_HOST.split(":");
  await fetch(`http://${h}:${p}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
}
