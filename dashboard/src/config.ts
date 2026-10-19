import {
  DASHBOARD_CONFIG_FILE,
  FIREBASE_HOSTING_INIT_URL,
  resolveDashboardConfig,
  type DashboardConfigFile,
  type DashboardConfigInput,
  type ResolvedDashboardConfig,
} from "@clayver/core";

/**
 * The dashboard's configuration, loaded at startup (not at build time), so one
 * build works for every Firebase project:
 *
 * 1. `clayver.config.json` next to index.html (written by `npx clayver init`),
 * 2. Firebase Hosting's `/__/firebase/init.json` plus defaults,
 * 3. `VITE_*` variables inlined at build time (local development).
 */
export type DashboardConfig = ResolvedDashboardConfig;

const env = import.meta.env;

function read(name: string): string | undefined {
  const value = (env as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Build-time values (`VITE_*`). Empty in the prebuilt dashboard the CLI ships. */
function buildTimeConfig(): DashboardConfigFile {
  const useEmulators = read("VITE_USE_EMULATORS");
  return {
    firebase: {
      apiKey: read("VITE_FIREBASE_API_KEY"),
      authDomain: read("VITE_FIREBASE_AUTH_DOMAIN"),
      projectId: read("VITE_FIREBASE_PROJECT_ID"),
      databaseURL: read("VITE_FIREBASE_DATABASE_URL"),
      storageBucket: read("VITE_FIREBASE_STORAGE_BUCKET"),
      messagingSenderId: read("VITE_FIREBASE_MESSAGING_SENDER_ID"),
      appId: read("VITE_FIREBASE_APP_ID"),
    },
    projectId: read("VITE_CLAYVER_PROJECT_ID"),
    functionsRegion: read("VITE_CLAYVER_FUNCTIONS_REGION"),
    vapidKey: read("VITE_FIREBASE_VAPID_KEY"),
    useEmulators: useEmulators ? useEmulators.toLowerCase() === "true" : undefined,
    emulatorHost: read("VITE_EMULATOR_HOST"),
    appCheck: { recaptchaEnterpriseSiteKey: read("VITE_CLAYVER_APP_CHECK_SITE_KEY") },
  };
}

type Fetched = { status: "ok"; value: unknown } | { status: "absent" } | { status: "invalid"; error: string };

/**
 * Fetches a JSON file. Dev servers and SPA hosts answer unknown paths with
 * index.html, so anything that is not JSON counts as absent.
 */
async function fetchJson(url: string): Promise<Fetched> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
  } catch {
    return { status: "absent" };
  }
  if (!res.ok) return { status: "absent" };
  const type = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (type.includes("text/html") || /^\s*</.test(text)) return { status: "absent" };
  try {
    return { status: "ok", value: JSON.parse(text) as unknown };
  } catch (err) {
    return { status: "invalid", error: (err as Error).message };
  }
}

export async function loadConfig(): Promise<DashboardConfig> {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  const input: DashboardConfigInput = { build: buildTimeConfig() };
  const file = await fetchJson(`${base}${DASHBOARD_CONFIG_FILE}`);
  if (file.status === "ok") input.file = file.value;
  if (file.status === "invalid") input.fileError = file.error;
  const fileHasFirebase =
    file.status === "ok" &&
    !!file.value &&
    typeof file.value === "object" &&
    typeof (file.value as { firebase?: unknown }).firebase === "object";
  if (!fileHasFirebase) {
    const hosting = await fetchJson(FIREBASE_HOSTING_INIT_URL);
    if (hosting.status === "ok") input.hosting = hosting.value;
  }
  return resolveDashboardConfig(input);
}
