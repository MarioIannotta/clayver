import { defineString } from "firebase-functions/params";

/** Comma-separated emails allowed to claim the first admin seat of a workspace. */
export const bootstrapAdmins = defineString("CLAYVER_BOOTSTRAP_ADMINS", { default: "" });

/** Optional public URL of the dashboard, used for web push click-through links. */
export const dashboardUrl = defineString("CLAYVER_DASHBOARD_URL", { default: "" });

/** Region for every Clayver function. Read from the environment at deploy time. */
export const REGION = process.env.CLAYVER_FUNCTIONS_REGION || "us-central1";

export const DEVICE_STALE_AFTER_MS = 270 * 24 * 60 * 60 * 1000;

/**
 * Reject callable requests without a valid App Check token. Read at deploy time
 * (set CLAYVER_ENFORCE_APP_CHECK=true in functions/.env); see docs/production-checklist.md.
 */
export const ENFORCE_APP_CHECK = process.env.CLAYVER_ENFORCE_APP_CHECK === "true";

/** Options shared by every Clayver callable. */
export const CALLABLE = { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK };
