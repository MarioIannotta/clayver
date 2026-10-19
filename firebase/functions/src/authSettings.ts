import { getApp } from "firebase-admin/app";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { CALLABLE } from "./config";
import { isActiveAdmin } from "./roles";
import { requireAuth, requireProjectId } from "./validation";

const IDENTITY_TOOLKIT = "https://identitytoolkit.googleapis.com/admin/v2";

interface AuthConfig {
  signIn?: { anonymous?: { enabled?: boolean } };
}

function firebaseProjectId(): string {
  const id = getApp().options.projectId ?? process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!id) throw new HttpsError("internal", "Could not determine the Firebase project.");
  return id;
}

async function identityToolkit(method: "GET" | "PATCH", query: string, body?: AuthConfig): Promise<AuthConfig> {
  const { access_token } = await getApp().options.credential!.getAccessToken();
  const project = firebaseProjectId();
  const res = await fetch(`${IDENTITY_TOOLKIT}/projects/${project}/config${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
      "x-goog-user-project": project,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text();
    logger.error("clayver could not update Firebase Auth settings", { status: res.status, detail });
    throw new HttpsError(
      res.status === 403 ? "permission-denied" : "internal",
      res.status === 403
        ? "The Cloud Functions service account cannot change Firebase Auth settings. Give it the Firebase Authentication Admin role."
        : "Could not read or change the Firebase Auth settings.",
    );
  }
  return (await res.json()) as AuthConfig;
}

/**
 * Reads, and with `anonymous` set changes, whether visitors may sign in anonymously.
 * This is a Firebase Auth setting, so it applies to the whole Firebase project.
 */
export const clayverAuthSettings = onCall(CALLABLE, async (request) => {
  const caller = requireAuth(request.auth);
  const projectId = requireProjectId(request.data?.projectId);
  if (!(await isActiveAdmin(projectId, caller.uid))) {
    throw new HttpsError("permission-denied", "Only admins can change sign-in settings.");
  }
  const anonymous = request.data?.anonymous;
  if (anonymous !== undefined && typeof anonymous !== "boolean") {
    throw new HttpsError("invalid-argument", "anonymous must be a boolean.");
  }
  const config =
    anonymous === undefined
      ? await identityToolkit("GET", "")
      : await identityToolkit("PATCH", "?updateMask=signIn.anonymous.enabled", { signIn: { anonymous: { enabled: anonymous } } });
  if (anonymous !== undefined) logger.info("clayver changed anonymous sign-in", { projectId, anonymous, by: caller.uid });
  return { anonymous: config.signIn?.anonymous?.enabled === true };
});
