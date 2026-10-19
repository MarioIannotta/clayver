import { describe, expect, it } from "vitest";
import { createPaths, isValidKey, isValidProjectId } from "../src/paths.js";
import { ClayverError } from "../src/errors.js";

describe("createPaths", () => {
  const p = createPaths("default");

  it("builds database paths under clayver/projects/{projectId}", () => {
    expect(p.project()).toBe("clayver/projects/default");
    expect(p.conversations()).toBe("clayver/projects/default/conversations");
    expect(p.conversation("-Nx1")).toBe("clayver/projects/default/conversations/-Nx1");
    expect(p.messages("-Nx1")).toBe("clayver/projects/default/messages/-Nx1");
    expect(p.message("-Nx1", "-Ny2")).toBe("clayver/projects/default/messages/-Nx1/-Ny2");
    expect(p.reads("-Nx1")).toBe("clayver/projects/default/reads/-Nx1");
    expect(p.customerRead("-Nx1")).toBe("clayver/projects/default/reads/-Nx1/customer");
    expect(p.agentRead("-Nx1")).toBe("clayver/projects/default/reads/-Nx1/agent");
    expect(p.inbox("v_abc")).toBe("clayver/projects/default/inbox/v_abc");
    expect(p.user("v_abc")).toBe("clayver/projects/default/users/v_abc");
    expect(p.agents()).toBe("clayver/projects/default/agents");
    expect(p.agent("uid1")).toBe("clayver/projects/default/agents/uid1");
    expect(p.agentSettings("uid1")).toBe("clayver/projects/default/agentSettings/uid1");
    expect(p.agentDevice("uid1", "device_123")).toBe(
      "clayver/projects/default/devices/agents/uid1/device_123",
    );
    expect(p.customerDevice("v_a", "device_123")).toBe(
      "clayver/projects/default/devices/customers/v_a/device_123",
    );
    expect(p.configPublic()).toBe("clayver/projects/default/config/public");
    expect(p.configPrivate()).toBe("clayver/projects/default/config/private");
  });

  it("builds the attachment storage path", () => {
    expect(p.storageAttachment("v_abc", "-Nx1", "-Na9", "photo.png")).toBe(
      "clayver/projects/default/customers/v_abc/conversations/-Nx1/-Na9/photo.png",
    );
    expect(p.storageConversationPrefix("v_abc", "-Nx1")).toBe(
      "clayver/projects/default/customers/v_abc/conversations/-Nx1/",
    );
  });

  it("rejects invalid project ids", () => {
    expect(() => createPaths("Default")).toThrow(ClayverError);
    expect(() => createPaths("")).toThrow(ClayverError);
    expect(() => createPaths("a".repeat(41))).toThrow(ClayverError);
    expect(isValidProjectId("my-app-2")).toBe(true);
  });

  it("rejects keys that would escape their subtree", () => {
    expect(() => p.conversation("a/b")).toThrow(ClayverError);
    expect(() => p.conversation("a.b")).toThrow(ClayverError);
    expect(() => p.conversation("")).toThrow(ClayverError);
    expect(() => p.user("x#y")).toThrow(ClayverError);
    expect(isValidKey("-NxAbc_09")).toBe(true);
  });

  it("validates device ids and file names", () => {
    expect(() => p.agentDevice("uid", "short")).toThrow(ClayverError);
    expect(() => p.agentDevice("uid", "bad id!!")).toThrow(ClayverError);
    expect(() => p.storageAttachment("c", "x", "a", "dir/file.png")).toThrow(ClayverError);
    expect(() => p.storageAttachment("c", "x", "a", "a".repeat(201))).toThrow(ClayverError);
  });
});
