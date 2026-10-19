/**
 * Error normalisation. Firebase Auth, Database, Storage and Functions all
 * report errors with different code formats; dashboards only need one.
 */

export type ClayverErrorCode =
  | "unauthenticated"
  | "permission-denied"
  | "invalid-argument"
  | "failed-precondition"
  | "not-found"
  | "already-exists"
  | "invalid-credentials"
  | "cancelled"
  | "popup-blocked"
  | "rate-limited"
  | "network"
  | "unavailable"
  | "file-too-large"
  | "unsupported-file-type"
  | "unsupported"
  | "unknown";

export class ClayverError extends Error {
  readonly code: ClayverErrorCode;
  /** The original error, when this one wraps a Firebase error. */
  override readonly cause?: unknown;

  constructor(code: ClayverErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ClayverError";
    this.code = code;
    this.cause = cause;
  }
}

export function isClayverError(err: unknown): err is ClayverError {
  return err instanceof ClayverError;
}

const DEFAULT_MESSAGES: Record<ClayverErrorCode, string> = {
  unauthenticated: "You are signed out. Please sign in again.",
  "permission-denied": "You do not have permission to do that.",
  "invalid-argument": "The request was invalid.",
  "failed-precondition": "The request cannot be completed in the current state.",
  "not-found": "Not found.",
  "already-exists": "It already exists.",
  "invalid-credentials": "Incorrect email or password.",
  cancelled: "The operation was cancelled.",
  "popup-blocked": "The sign-in popup was blocked by the browser. Allow popups and try again.",
  "rate-limited": "Too many attempts. Wait a moment and try again.",
  network: "Network error. Check your connection and try again.",
  unavailable: "The service is temporarily unavailable. Try again shortly.",
  "file-too-large": "The file is too large.",
  "unsupported-file-type": "This file type is not supported.",
  unsupported: "This browser does not support this feature.",
  unknown: "Something went wrong.",
};

/** Firebase error code (without or with service prefix) -> Clayver code. */
const CODE_MAP: Record<string, ClayverErrorCode> = {
  // Callable functions ("functions/<code>") and generic gRPC-style codes.
  unauthenticated: "unauthenticated",
  "permission-denied": "permission-denied",
  "invalid-argument": "invalid-argument",
  "failed-precondition": "failed-precondition",
  "not-found": "not-found",
  "already-exists": "already-exists",
  unavailable: "unavailable",
  "deadline-exceeded": "network",
  "resource-exhausted": "rate-limited",
  cancelled: "cancelled",
  // Auth
  "auth/invalid-credential": "invalid-credentials",
  "auth/invalid-login-credentials": "invalid-credentials",
  "auth/wrong-password": "invalid-credentials",
  "auth/user-not-found": "invalid-credentials",
  "auth/invalid-email": "invalid-argument",
  "auth/missing-password": "invalid-argument",
  "auth/user-disabled": "permission-denied",
  "auth/popup-closed-by-user": "cancelled",
  "auth/cancelled-popup-request": "cancelled",
  "auth/user-cancelled": "cancelled",
  "auth/popup-blocked": "popup-blocked",
  "auth/too-many-requests": "rate-limited",
  "auth/network-request-failed": "network",
  "auth/operation-not-allowed": "failed-precondition",
  "auth/unauthorized-domain": "failed-precondition",
  "auth/requires-recent-login": "unauthenticated",
  "auth/user-token-expired": "unauthenticated",
  // Realtime Database
  permission_denied: "permission-denied",
  // Storage
  "storage/unauthorized": "permission-denied",
  "storage/unauthenticated": "unauthenticated",
  "storage/canceled": "cancelled",
  "storage/object-not-found": "not-found",
  "storage/retry-limit-exceeded": "network",
  "storage/quota-exceeded": "rate-limited",
  // Messaging
  "messaging/permission-blocked": "permission-denied",
  "messaging/permission-default": "cancelled",
  "messaging/unsupported-browser": "unsupported",
  "messaging/failed-service-worker-registration": "unsupported",
};

const SERVICE_PREFIXES = ["functions/", "database/", "storage/", "messaging/", "auth/"];

/** Maps a raw Firebase code to a Clayver code. Exported for tests. */
export function mapFirebaseCode(code: string | undefined | null): ClayverErrorCode {
  if (!code) return "unknown";
  const normalized = code.trim().toLowerCase();
  const direct = CODE_MAP[normalized];
  if (direct) return direct;
  for (const prefix of SERVICE_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      const mapped = CODE_MAP[normalized.slice(prefix.length)];
      if (mapped) return mapped;
    }
  }
  return "unknown";
}

function readString(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === "object" && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

/**
 * Converts anything thrown by the Firebase SDK (or by Clayver itself) into a
 * ClayverError with a human-readable message.
 *
 * For callable functions the server's message is kept, because the Clayver
 * functions return actionable messages (for example why bootstrap failed).
 */
export function toClayverError(err: unknown): ClayverError {
  if (err instanceof ClayverError) return err;

  const rawCode = readString(err, "code");
  const rawMessage = readString(err, "message") ?? (typeof err === "string" ? err : undefined);
  let code = mapFirebaseCode(rawCode);

  // The Realtime Database reports permission errors as messages only.
  if (code === "unknown" && rawMessage && /permission[_ ]denied/i.test(rawMessage)) {
    code = "permission-denied";
  }
  if (code === "unknown" && rawMessage && /network|offline|failed to fetch/i.test(rawMessage)) {
    code = "network";
  }

  const isCallable = rawCode?.startsWith("functions/") ?? false;
  const serverMessage =
    isCallable && rawMessage && !/^internal$/i.test(rawMessage) ? rawMessage : undefined;

  const message =
    serverMessage ??
    (code === "unknown" && rawMessage ? stripFirebasePrefix(rawMessage) : DEFAULT_MESSAGES[code]);

  return new ClayverError(code, message, err);
}

/** "Firebase: Error (auth/foo)." -> "Error (auth/foo)." */
function stripFirebasePrefix(message: string): string {
  return message.replace(/^Firebase:\s*/i, "");
}

/** Human-readable message for anything thrown. */
export function errorMessage(err: unknown): string {
  return toClayverError(err).message;
}
