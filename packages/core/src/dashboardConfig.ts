/**
 * Runtime configuration of a Clayver dashboard.
 *
 * A prebuilt dashboard is environment-independent: it reads its configuration
 * when it starts, from (in this order)
 *
 * 1. `clayver.config.json` next to `index.html` (written by `npx clayver init`),
 * 2. Firebase Hosting's reserved `/__/firebase/init.json` (the default web app of
 *    the hosting project) plus Clayver defaults,
 * 3. values inlined at build time (the dashboard's `VITE_*` variables).
 *
 * This module holds the pure resolution and validation logic so it can be
 * tested and reused; fetching the files is the dashboard's job.
 */
import type { FirebaseOptions } from "firebase/app";
import { DEFAULT_FUNCTIONS_REGION, DEFAULT_PROJECT_ID } from "./client.js";
import { isValidProjectId } from "./paths.js";

/** File name of the runtime configuration, served next to `index.html`. */
export const DASHBOARD_CONFIG_FILE = "clayver.config.json";
/** Firebase Hosting's reserved URL with the hosting project's web config. */
export const FIREBASE_HOSTING_INIT_URL = "/__/firebase/init.json";

/** The Firebase web app config fields the dashboard uses. All are public identifiers. */
export const FIREBASE_WEB_CONFIG_KEYS = [
  "apiKey",
  "authDomain",
  "databaseURL",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
  "measurementId",
] as const;

export type FirebaseWebConfig = Partial<Record<(typeof FIREBASE_WEB_CONFIG_KEYS)[number], string>>;

/** Shape of `clayver.config.json`. Every field is optional; see {@link resolveDashboardConfig}. */
export interface DashboardConfigFile {
  /** Firebase web app config (public; from `firebase apps:sdkconfig WEB`). */
  firebase?: FirebaseWebConfig;
  /** Clayver workspace id (the SDKs' `projectId`). Default `"default"`. */
  projectId?: string;
  /** Region the Clayver functions run in. Default `us-central1`. */
  functionsRegion?: string;
  /** Web push public key (Project settings > Cloud Messaging > Web Push certificates). */
  vapidKey?: string;
  /** Connect to the Firebase Local Emulator Suite. */
  useEmulators?: boolean;
  /** Emulator host. Default `127.0.0.1`. */
  emulatorHost?: string;
  /** Optional Firebase App Check with reCAPTCHA Enterprise. */
  appCheck?: { recaptchaEnterpriseSiteKey?: string };
}

export type DashboardConfigSource = "clayver.config.json" | "firebase-hosting" | "build" | "none";

export interface ResolvedDashboardConfig {
  firebase: FirebaseOptions;
  projectId: string;
  functionsRegion: string;
  vapidKey: string;
  useEmulators: boolean;
  emulatorHost: string;
  /** App Check settings, or null when App Check is not used. */
  appCheck: { recaptchaEnterpriseSiteKey: string } | null;
  /** Where the Firebase web config came from. */
  source: DashboardConfigSource;
  /** Human-readable problems; a dashboard shows them instead of starting. */
  problems: string[];
}

export interface DashboardConfigInput {
  /** Parsed `clayver.config.json`, or undefined when it is not served. */
  file?: unknown;
  /** Set when `clayver.config.json` was served but could not be parsed. */
  fileError?: string;
  /** Parsed `/__/firebase/init.json`, or undefined when not on Firebase Hosting. */
  hosting?: unknown;
  /** Values inlined at build time. */
  build?: DashboardConfigFile;
}

const REGION_PATTERN = /^[a-z]+(-[a-z]+)+[0-9]+$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Keeps the known web config keys that are non-empty strings. */
export function pickFirebaseWebConfig(value: unknown): FirebaseWebConfig {
  const out: FirebaseWebConfig = {};
  if (!isObject(value)) return out;
  for (const key of FIREBASE_WEB_CONFIG_KEYS) {
    const v = value[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

/**
 * Combines the available sources into one validated configuration. The
 * Firebase web config comes from a single source (the first one that has
 * any); the other fields fall back field by field: file, then build-time
 * values, then defaults.
 */
export function resolveDashboardConfig(input: DashboardConfigInput): ResolvedDashboardConfig {
  const problems: string[] = [];
  if (input.fileError) problems.push(`${DASHBOARD_CONFIG_FILE} could not be read: ${input.fileError}`);
  if (input.file !== undefined && !isObject(input.file)) {
    problems.push(`${DASHBOARD_CONFIG_FILE} must contain a JSON object.`);
  }
  const file: Record<string, unknown> = isObject(input.file) ? input.file : {};
  const build: DashboardConfigFile = input.build ?? {};

  const fromFile = pickFirebaseWebConfig(file.firebase);
  const fromHosting = pickFirebaseWebConfig(input.hosting);
  const fromBuild = pickFirebaseWebConfig(build.firebase);
  let source: DashboardConfigSource = "none";
  let web: FirebaseWebConfig = {};
  if (Object.keys(fromFile).length) [source, web] = ["clayver.config.json", fromFile];
  else if (fromHosting.apiKey) [source, web] = ["firebase-hosting", fromHosting];
  else if (Object.keys(fromBuild).length) [source, web] = ["build", fromBuild];

  const useEmulators = bool(file.useEmulators) ?? bool(build.useEmulators) ?? false;
  const projectIdRaw = file.projectId ?? build.projectId;
  const projectId = str(projectIdRaw) ?? DEFAULT_PROJECT_ID;
  const functionsRegion = str(file.functionsRegion) ?? str(build.functionsRegion) ?? DEFAULT_FUNCTIONS_REGION;
  const vapidKey = str(file.vapidKey) ?? str(build.vapidKey) ?? "";
  const emulatorHost = str(file.emulatorHost) ?? str(build.emulatorHost) ?? "127.0.0.1";

  let appCheck: ResolvedDashboardConfig["appCheck"] = null;
  if (file.appCheck !== undefined && file.appCheck !== null) {
    const siteKey = isObject(file.appCheck) ? str(file.appCheck.recaptchaEnterpriseSiteKey) : undefined;
    if (siteKey) appCheck = { recaptchaEnterpriseSiteKey: siteKey };
    else problems.push(`appCheck in ${DASHBOARD_CONFIG_FILE} must be { "recaptchaEnterpriseSiteKey": "<site key>" }.`);
  } else {
    const siteKey = str(build.appCheck?.recaptchaEnterpriseSiteKey);
    if (siteKey) appCheck = { recaptchaEnterpriseSiteKey: siteKey };
  }

  if (useEmulators) {
    web.projectId ??= "demo-clayver";
    web.apiKey ??= "demo-api-key";
    web.storageBucket ??= `${web.projectId}.appspot.com`;
    // The emulator names the default instance after the project (the namespace the Functions emulator uses).
    web.databaseURL ??= `https://${web.projectId}.firebaseio.com`;
  }

  const firebase: FirebaseOptions = { ...web };
  const required: (keyof FirebaseWebConfig)[] = useEmulators
    ? ["projectId"]
    : ["apiKey", "authDomain", "projectId", "databaseURL", "storageBucket", "appId"];

  if (source === "none" && !useEmulators) {
    problems.push(
      `No Firebase configuration found. Serve a ${DASHBOARD_CONFIG_FILE} next to index.html ` +
        "(`npx clayver init` writes one), host the dashboard on Firebase Hosting, or build it with the VITE_FIREBASE_* variables.",
    );
  } else {
    const where = source === "firebase-hosting" ? FIREBASE_HOSTING_INIT_URL : source === "build" ? "build-time config" : DASHBOARD_CONFIG_FILE;
    for (const key of required) {
      if (!web[key]) {
        const hint =
          key === "databaseURL" && source === "firebase-hosting"
            ? " (create the Realtime Database, or add it to clayver.config.json)"
            : "";
        problems.push(`firebase.${key} is missing in ${where}${hint}.`);
      }
    }
  }
  if (projectIdRaw !== undefined && typeof projectIdRaw !== "string") {
    problems.push(`projectId must be a string.`);
  } else if (!isValidProjectId(projectId)) {
    problems.push(`projectId "${projectId}" must match ^[a-z0-9-]{1,40}$.`);
  }
  if (!REGION_PATTERN.test(functionsRegion)) {
    problems.push(`functionsRegion "${functionsRegion}" is not a Cloud Functions region (for example us-central1).`);
  }

  return { firebase, projectId, functionsRegion, vapidKey, useEmulators, emulatorHost, appCheck, source, problems };
}
