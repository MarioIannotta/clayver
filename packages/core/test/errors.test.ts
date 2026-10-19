import { describe, expect, it } from "vitest";
import { ClayverError, errorMessage, mapFirebaseCode, toClayverError } from "../src/errors.js";

describe("mapFirebaseCode", () => {
  it.each([
    ["auth/invalid-credential", "invalid-credentials"],
    ["auth/wrong-password", "invalid-credentials"],
    ["auth/popup-closed-by-user", "cancelled"],
    ["auth/popup-blocked", "popup-blocked"],
    ["auth/too-many-requests", "rate-limited"],
    ["auth/network-request-failed", "network"],
    ["functions/permission-denied", "permission-denied"],
    ["functions/failed-precondition", "failed-precondition"],
    ["functions/unauthenticated", "unauthenticated"],
    ["functions/invalid-argument", "invalid-argument"],
    ["functions/not-found", "not-found"],
    ["PERMISSION_DENIED", "permission-denied"],
    ["storage/unauthorized", "permission-denied"],
    ["storage/canceled", "cancelled"],
    ["messaging/permission-blocked", "permission-denied"],
    ["something/else", "unknown"],
    [undefined, "unknown"],
  ] as const)("%s -> %s", (input, expected) => {
    expect(mapFirebaseCode(input)).toBe(expected);
  });
});

describe("toClayverError", () => {
  it("passes ClayverErrors through", () => {
    const e = new ClayverError("not-found", "x");
    expect(toClayverError(e)).toBe(e);
  });

  it("keeps the server message of callable errors", () => {
    const e = toClayverError({
      code: "functions/failed-precondition",
      message: "This workspace already has an admin.",
    });
    expect(e.code).toBe("failed-precondition");
    expect(e.message).toBe("This workspace already has an admin.");
  });

  it("uses a friendly message for auth errors", () => {
    const e = toClayverError({ code: "auth/invalid-credential", message: "Firebase: Error (auth/invalid-credential)." });
    expect(e.code).toBe("invalid-credentials");
    expect(e.message).toBe("Incorrect email or password.");
  });

  it("detects database permission errors from the message", () => {
    const e = toClayverError(new Error("PERMISSION_DENIED: Permission denied"));
    expect(e.code).toBe("permission-denied");
  });

  it("falls back to the raw message for unknown errors", () => {
    expect(errorMessage(new Error("Firebase: boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
  });
});
