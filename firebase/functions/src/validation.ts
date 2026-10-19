import { HttpsError } from "firebase-functions/v2/https";
import type { AuthData } from "firebase-functions/v2/tasks";
import { PROJECT_ID_RE } from "./paths";

export function requireAuth(authData: AuthData | undefined): AuthData {
  if (!authData) throw new HttpsError("unauthenticated", "Sign in first.");
  return authData;
}

export function requireProjectId(value: unknown): string {
  if (value === undefined || value === null) return "default";
  if (typeof value !== "string" || !PROJECT_ID_RE.test(value)) {
    throw new HttpsError("invalid-argument", "projectId must match ^[a-z0-9-]{1,40}$.");
  }
  return value;
}

export function requireString(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new HttpsError("invalid-argument", `${name} must be a string of ${min}-${max} characters.`);
  }
  return value;
}

export function optionalString(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireString(value, name, 1, max);
}
