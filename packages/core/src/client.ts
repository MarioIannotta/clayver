/**
 * Creates the Firebase service instances a Clayver dashboard needs and binds
 * them to one workspace (`projectId`).
 */
import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from "firebase/app-check";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectDatabaseEmulator, getDatabase, type Database } from "firebase/database";
import { connectFunctionsEmulator, getFunctions, type Functions } from "firebase/functions";
import { connectStorageEmulator, getStorage, type FirebaseStorage } from "firebase/storage";
import { createPaths, type ClayverPaths } from "./paths.js";

export const DEFAULT_PROJECT_ID = "default";
export const DEFAULT_FUNCTIONS_REGION = "us-central1";

export interface EmulatorOptions {
  /** Host of all emulators. Default `127.0.0.1`. */
  host?: string;
  authPort?: number;
  databasePort?: number;
  storagePort?: number;
  functionsPort?: number;
}

export interface ClayverClientOptions {
  /** An initialised app, or a config to initialise one with. */
  app?: FirebaseApp;
  firebaseConfig?: FirebaseOptions;
  /** Clayver workspace id. Default `"default"`. */
  projectId?: string;
  /** Region the Clayver functions are deployed to. Default `us-central1`. */
  functionsRegion?: string;
  /** Connect to the Firebase Local Emulator Suite. */
  emulators?: EmulatorOptions | boolean;
  /**
   * Initialise Firebase App Check with reCAPTCHA Enterprise before any other
   * Firebase service is created, so every request carries an App Check token.
   */
  appCheck?: AppCheckOptions | null;
}

export interface AppCheckOptions {
  /** reCAPTCHA Enterprise site key registered for this web app in App Check. */
  recaptchaEnterpriseSiteKey: string;
  /** Default true. */
  isTokenAutoRefreshEnabled?: boolean;
}

/** Everything the data-access functions need. Create once per page. */
export interface ClayverClient {
  readonly app: FirebaseApp;
  readonly projectId: string;
  readonly functionsRegion: string;
  readonly auth: Auth;
  readonly db: Database;
  readonly storage: FirebaseStorage;
  readonly functions: Functions;
  readonly paths: ClayverPaths;
  readonly usingEmulators: boolean;
  /** Set when App Check was initialised. */
  readonly appCheck: AppCheck | null;
}

export function createClayverClient(options: ClayverClientOptions): ClayverClient {
  const projectId = options.projectId || DEFAULT_PROJECT_ID;
  const paths = createPaths(projectId);
  const functionsRegion = options.functionsRegion || DEFAULT_FUNCTIONS_REGION;

  let app = options.app;
  if (!app) {
    if (!options.firebaseConfig) {
      throw new Error("createClayverClient: pass either `app` or `firebaseConfig`.");
    }
    const config = { ...options.firebaseConfig };
    if (options.emulators && !config.databaseURL && config.projectId) {
      // The database emulator needs a namespace; default to the project's default instance.
      config.databaseURL = `https://${config.projectId}-default-rtdb.firebaseio.com`;
    }
    app = getApps()[0] ?? initializeApp(config);
  }

  // App Check must be initialised before Auth, Database, Storage or Functions.
  let appCheck: AppCheck | null = null;
  if (options.appCheck?.recaptchaEnterpriseSiteKey) {
    const flagged = app as FirebaseApp & { __clayverAppCheck?: AppCheck };
    appCheck = flagged.__clayverAppCheck ??= initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(options.appCheck.recaptchaEnterpriseSiteKey),
      isTokenAutoRefreshEnabled: options.appCheck.isTokenAutoRefreshEnabled ?? true,
    });
  }

  const auth = getAuth(app);
  const db = getDatabase(app);
  const storage = getStorage(app);
  const functions = getFunctions(app, functionsRegion);

  const emu = options.emulators === true ? {} : options.emulators || null;
  if (emu) {
    const host = emu.host ?? "127.0.0.1";
    // Each connect* call throws if the service was already used; guard with a flag on the app.
    const flagged = app as FirebaseApp & { __clayverEmulators?: boolean };
    if (!flagged.__clayverEmulators) {
      flagged.__clayverEmulators = true;
      connectAuthEmulator(auth, `http://${host}:${emu.authPort ?? 9099}`, { disableWarnings: true });
      connectDatabaseEmulator(db, host, emu.databasePort ?? 9000);
      connectStorageEmulator(storage, host, emu.storagePort ?? 9199);
      connectFunctionsEmulator(functions, host, emu.functionsPort ?? 5001);
    }
  }

  return {
    app,
    projectId,
    functionsRegion,
    auth,
    db,
    storage,
    functions,
    paths,
    usingEmulators: !!emu,
    appCheck,
  };
}
