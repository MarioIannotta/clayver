import { describe, expect, it } from "vitest";
import {
  grantRole,
  nextClaims,
  revokeRole,
  runAdmin,
  type AdminBackend,
  type AdminUser,
} from "../src/commands/admin.js";
import { MemoryLogger } from "../src/core/logger.js";

class FakeAdmin implements AdminBackend {
  users = new Map<string, AdminUser>();
  db: Record<string, unknown> = {};
  revoked: string[] = [];
  async getUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email);
  }
  async getUser(uid: string) {
    return this.users.get(uid);
  }
  async createUser(email: string) {
    const u = { uid: `uid-${this.users.size + 1}`, email };
    this.users.set(u.uid, u);
    return u;
  }
  async setCustomUserClaims(uid: string, claims: Record<string, unknown> | null) {
    const u = this.users.get(uid)!;
    u.customClaims = claims ?? undefined;
  }
  async revokeRefreshTokens(uid: string) {
    this.revoked.push(uid);
  }
  async passwordResetLink(email: string) {
    return `https://example.com/reset?e=${email}`;
  }
  async dbGet(path: string) {
    if (path in this.db) return this.db[path] ?? null;
    if (path.endsWith("/agents")) {
      const prefix = `${path}/`;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(this.db)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
      return Object.keys(out).length ? out : null;
    }
    return this.db[path] ?? null;
  }
  async dbSet(path: string, value: unknown) {
    if (value === null) delete this.db[path];
    else this.db[path] = value;
  }
}

describe("clayver admin", () => {
  it("grant writes agents/{uid} and merges the clayver_roles claim", async () => {
    const admin = new FakeAdmin();
    admin.users.set("u1", { uid: "u1", email: "ana@example.com", customClaims: { tier: "gold", clayver_roles: { other: "agent" } } });
    const { record } = await grantRole(admin, { workspace: "default", email: "Ana@Example.com", role: "admin", now: 1000 }, new MemoryLogger());
    expect(admin.db["clayver/projects/default/agents/u1"]).toEqual(record);
    expect(record).toEqual({ role: "admin", active: true, email: "ana@example.com", displayName: "ana", createdAt: 1000, updatedAt: 1000, grantedBy: "clayver-cli" });
    expect(admin.users.get("u1")?.customClaims).toEqual({ tier: "gold", clayver_roles: { other: "agent", default: "admin" } });
  });

  it("grant --create creates the user and returns a password setup link", async () => {
    const admin = new FakeAdmin();
    const r = await grantRole(admin, { workspace: "default", email: "new@example.com", role: "agent", create: true }, new MemoryLogger());
    expect(r.inviteLink).toContain("new@example.com");
    await expect(grantRole(new FakeAdmin(), { workspace: "default", email: "x@example.com", role: "agent" }, new MemoryLogger())).rejects.toMatchObject({ hint: expect.stringContaining("--create") });
  });

  it("revoke deactivates the agent, drops the claim and revokes tokens, but protects the last admin", async () => {
    const admin = new FakeAdmin();
    admin.users.set("u1", { uid: "u1", email: "a@example.com" });
    admin.users.set("u2", { uid: "u2", email: "b@example.com" });
    const log = new MemoryLogger();
    await grantRole(admin, { workspace: "default", email: "a@example.com", role: "admin" }, log);
    await expect(revokeRole(admin, { workspace: "default", email: "a@example.com" }, log)).rejects.toThrow(/only active admin/);
    await grantRole(admin, { workspace: "default", email: "b@example.com", role: "admin" }, log);
    await revokeRole(admin, { workspace: "default", email: "a@example.com" }, log);
    expect(admin.db["clayver/projects/default/agents/u1"]).toMatchObject({ active: false, role: "admin" });
    expect(admin.users.get("u1")?.customClaims).toBeUndefined();
    expect(admin.revoked).toEqual(["u1"]);
  });

  it("dry run writes nothing", async () => {
    const admin = new FakeAdmin();
    admin.users.set("u1", { uid: "u1", email: "a@example.com" });
    const log = new MemoryLogger();
    await grantRole(admin, { workspace: "default", email: "a@example.com", role: "agent", dryRun: true }, log);
    expect(admin.db).toEqual({});
    expect(log.text()).toContain("would write clayver/projects/default/agents/u1");
  });

  it("nextClaims keeps unrelated claims and removes an empty roles map", () => {
    expect(nextClaims({ a: 1, clayver_roles: { default: "agent" } }, "default", null)).toEqual({ a: 1 });
    expect(nextClaims(undefined, "default", null)).toBeNull();
  });
});

describe("clayver admin --uid", () => {
  it("grants and revokes an account without an email by uid", async () => {
    const admin = new FakeAdmin();
    admin.users.set("phone1", { uid: "phone1" });
    admin.users.set("u2", { uid: "u2", email: "b@example.com" });
    const log = new MemoryLogger();
    await grantRole(admin, { workspace: "default", email: "b@example.com", role: "admin" }, log);
    const { record } = await grantRole(admin, { workspace: "default", uid: "phone1", role: "agent", displayName: "Night shift", now: 5 }, log);
    expect(record).toEqual({ role: "agent", active: true, email: null, displayName: "Night shift", createdAt: 5, updatedAt: 5, grantedBy: "clayver-cli" });
    expect(admin.users.get("phone1")?.customClaims).toEqual({ clayver_roles: { default: "agent" } });
    await revokeRole(admin, { workspace: "default", uid: "phone1" }, log);
    expect(admin.db["clayver/projects/default/agents/phone1"]).toMatchObject({ active: false });
    expect(admin.revoked).toEqual(["phone1"]);
    await expect(grantRole(admin, { workspace: "default", uid: "nobody", role: "agent" }, log)).rejects.toThrow(/uid nobody/);
  });

  it("runAdmin needs exactly one of --email and --uid", async () => {
    const deps = { cwd: process.cwd(), logger: new MemoryLogger(), adminBackend: new FakeAdmin() } as never;
    await expect(runAdmin("grant", { role: "agent", project: "shop-prod" }, deps)).rejects.toThrow(/exactly one/);
    await expect(runAdmin("grant", { role: "agent", project: "shop-prod", email: "a@b.co", uid: "u" }, deps)).rejects.toThrow(/exactly one/);
    await expect(runAdmin("grant", { role: "agent", project: "shop-prod", uid: "u", create: true }, deps)).rejects.toThrow(/--create/);
    const admin = new FakeAdmin();
    admin.users.set("u9", { uid: "u9" });
    await runAdmin("grant", { role: "agent", project: "shop-prod", uid: "u9" }, { cwd: process.cwd(), logger: new MemoryLogger(), adminBackend: admin } as never);
    expect(admin.db["clayver/projects/default/agents/u9"]).toMatchObject({ role: "agent", active: true });
  });
});
