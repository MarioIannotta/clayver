import { readFileSync } from "node:fs";

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const CLI_VERSION = readVersion();

export const DEFAULT_WORKSPACE = "default";
export const DEFAULT_REGION = "us-central1";
export const WORKSPACE_PATTERN = /^[a-z0-9-]{1,40}$/;
export const FIREBASE_PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
export const MIN_NODE = { major: 20, minor: 17 };

/** Key under `rules` that Clayver owns in database.rules.json. */
export const DATABASE_RULES_KEY = "clayver";
export const FUNCTIONS_DIR = "clayver-functions";
export const FUNCTIONS_CODEBASE = "clayver";
export const FUNCTIONS_RUNTIME = "nodejs22";
export const DASHBOARD_DIR = "clayver-dashboard";
/** Runtime config file the dashboard loads from its own origin. */
export const DASHBOARD_CONFIG_FILE = "clayver.config.json";
/** Display name of the Firebase web app `init` registers for the dashboard. */
export const DASHBOARD_WEB_APP_NAME = "Clayver dashboard";
export const DEFAULT_DASHBOARD_PORT = 5173;
export const DEFAULT_DASHBOARD_HOST = "127.0.0.1";
/** Folder inside the dashboard folder that `clayver dashboard deploy` fills and deploys. */
export const DASHBOARD_PUBLIC_DIR = "public";
export const EXAMPLE_DIR = "clayver-example";

/**
 * SDK coordinates used in generated snippets and dependency edits.
 * Keep in sync with the published iOS / Android / Flutter packages.
 */
export const SDK = {
  version: "0.3.3",
  ios: {
    spmUrl: "https://github.com/MarioIannotta/clayver",
    spmProduct: "ClayverSDK",
    module: "ClayverSDK",
  },
  android: {
    coordinates: "com.marioiannotta.clayver:clayver-android",
    version: "0.3.3",
    packageName: "com.clayver.sdk",
  },
  flutter: {
    package: "clayver",
    version: "^0.3.3",
  },
} as const;

export const LINKS = {
  console: (p: string) => `https://console.firebase.google.com/project/${p}/overview`,
  usage: (p: string) => `https://console.firebase.google.com/project/${p}/usage/details`,
  database: (p: string) => `https://console.firebase.google.com/project/${p}/database`,
  storage: (p: string) => `https://console.firebase.google.com/project/${p}/storage`,
  authProviders: (p: string) => `https://console.firebase.google.com/project/${p}/authentication/providers`,
  cloudMessaging: (p: string) => `https://console.firebase.google.com/project/${p}/settings/cloudmessaging`,
  functions: (p: string) => `https://console.firebase.google.com/project/${p}/functions`,
  apnsKey: "https://developer.apple.com/account/resources/authkeys/list",
  pricing: "https://firebase.google.com/pricing",
  firebaseCli: "https://firebase.google.com/docs/cli#install_the_firebase_cli",
  flutterfire: "https://firebase.google.com/docs/flutter/setup",
  adc: "https://cloud.google.com/docs/authentication/provide-credentials-adc#local-dev",
  authorizedDomains: (p: string) => `https://console.firebase.google.com/project/${p}/authentication/settings`,
  webPushCerts: (p: string) => `https://console.firebase.google.com/project/${p}/settings/cloudmessaging`,
  dashboardDocs: "https://github.com/MarioIannotta/clayver/tree/main/dashboard",
};
