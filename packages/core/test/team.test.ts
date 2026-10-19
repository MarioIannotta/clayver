import { describe, expect, it } from "vitest";
import { buildSetAgentRoleRequest } from "../src/team.js";
import { ClayverError } from "../src/errors.js";

describe("role grants", () => {
  it("builds the clayverSetAgentRole payload for a Firebase account", () => {
    expect(buildSetAgentRoleRequest("default", { email: "A@b.co ", role: "admin", displayName: " Ana " })).toEqual({
      projectId: "default",
      email: "A@b.co",
      role: "admin",
      displayName: "Ana",
    });
    expect(buildSetAgentRoleRequest("default", { uid: " u1 ", role: "none" })).toEqual({
      projectId: "default",
      uid: "u1",
      role: "none",
    });
  });

  it("requires exactly one target and a valid role", () => {
    expect(() => buildSetAgentRoleRequest("default", { role: "agent" })).toThrow(ClayverError);
    expect(() => buildSetAgentRoleRequest("default", { email: "a@b.co", uid: "u", role: "agent" })).toThrow(/only one/);
    expect(() => buildSetAgentRoleRequest("default", { email: "not-an-email", role: "agent" })).toThrow(/valid email/);
    expect(() => buildSetAgentRoleRequest("default", { uid: "u1", role: "owner" as never })).toThrow(/Invalid role/);
  });
});
