/**
 * Realtime Database security rules: unauthorized reads/writes, sender spoofing,
 * role escalation, customer isolation and input validation.
 */
import { assertFails, assertSucceeds, type RulesTestContext } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BASE, DB_HOST, NS, resetData, testEnv } from "./env";

const URL = `http://${DB_HOST}?ns=${NS}`;
const db = (ctx: RulesTestContext) => ctx.database(URL);
const TS = { ".sv": "timestamp" };

let env: Awaited<ReturnType<typeof testEnv>>;
const anon = (uid: string) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } });
// A token still carrying the removed `clayver_cid` claim must not change who the caller is.
const staleClaim = (uid: string, cid: string) =>
  env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" }, clayver_cid: cid });
const user = (uid: string) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } });

async function seed(path: string, value: unknown) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await db(ctx).ref(path).set(value);
  });
}

const conversation = (customerId: string) => ({ customerId, status: "open", createdAt: TS });
const customerMessage = (senderId: string, extra: Record<string, unknown> = {}) => ({
  senderId,
  senderType: "customer",
  text: "hello",
  createdAt: TS,
  ...extra,
});

beforeAll(async () => {
  env = await testEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await resetData();
  await seed(`${BASE}/agents/agentA`, { role: "agent", active: true, email: "a@example.com" });
  await seed(`${BASE}/agents/adminA`, { role: "admin", active: true, email: "admin@example.com" });
  await seed(`${BASE}/agents/revoked`, { role: "agent", active: false });
  await seed(`${BASE}/conversations/c1`, { customerId: "cust1", status: "open", createdAt: 1 });
  await seed(`${BASE}/conversations/cV`, { customerId: "v_alice", status: "open", createdAt: 1 });
  await seed(`${BASE}/messages/c1/m0`, { senderId: "cust1", senderType: "customer", text: "hi", createdAt: 1 });
});

describe("unauthenticated access", () => {
  it("cannot read or write anything", async () => {
    const ctx = env.unauthenticatedContext();
    await assertFails(db(ctx).ref(`${BASE}/conversations/c1`).get());
    await assertFails(db(ctx).ref(`${BASE}/messages/c1`).get());
    await assertFails(db(ctx).ref(`${BASE}/conversations/new`).set(conversation("anyone")));
    await assertFails(db(ctx).ref("/").get());
    await assertFails(db(ctx).ref(`${BASE}/config/public`).get());
  });
});

describe("customer isolation", () => {
  it("a customer reads their own conversation and messages", async () => {
    const c = db(anon("cust1"));
    await assertSucceeds(c.ref(`${BASE}/conversations/c1`).get());
    await assertSucceeds(c.ref(`${BASE}/messages/c1`).get());
    await assertSucceeds(c.ref(`${BASE}/messages/c1`).orderByKey().limitToLast(10).get());
  });

  it("a customer cannot read other customers' data", async () => {
    const c = db(anon("cust2"));
    await assertFails(c.ref(`${BASE}/conversations/c1`).get());
    await assertFails(c.ref(`${BASE}/messages/c1`).get());
    await assertFails(c.ref(`${BASE}/conversations`).get());
    await assertFails(c.ref(`${BASE}/users/cust1`).get());
    await assertFails(c.ref(`${BASE}/inbox/cust1`).get());
    await assertFails(c.ref(`${BASE}/devices/customers/cust1`).get());
    await assertFails(c.ref(`${BASE}/reads/c1`).get());
  });

  it("a customer cannot list conversations even with a query", async () => {
    await assertFails(
      db(anon("cust1")).ref(`${BASE}/conversations`).orderByChild("customerId").equalTo("cust1").get(),
    );
  });

  it("the customer id is always the auth uid, whatever claims the token carries", async () => {
    const device = db(staleClaim("deviceUid1", "v_alice"));
    await assertFails(device.ref(`${BASE}/conversations/cV`).get());
    await assertFails(device.ref(`${BASE}/messages/cV`).get());
    await seed(`${BASE}/conversations/cU`, { customerId: "deviceUid1", status: "open", createdAt: 1 });
    await assertSucceeds(device.ref(`${BASE}/conversations/cU`).get());
  });

  it("a customer cannot read agents, config/private or server-only indexes", async () => {
    const c = db(anon("cust1"));
    await assertFails(c.ref(`${BASE}/agents`).get());
    await assertFails(c.ref(`${BASE}/config/private`).get());
    await assertFails(c.ref(`${BASE}/tokenIndex`).get());
    await assertFails(c.ref(`${BASE}/notificationLog`).get());
    await assertSucceeds(c.ref(`${BASE}/config/public`).get());
  });
});

describe("conversations", () => {
  it("a customer creates a conversation for themselves", async () => {
    await assertSucceeds(db(anon("cust1")).ref(`${BASE}/conversations/c2`).set(conversation("cust1")));
  });

  it("a customer cannot create a conversation for someone else", async () => {
    await assertFails(db(anon("cust1")).ref(`${BASE}/conversations/c2`).set(conversation("cust2")));
    await assertFails(db(staleClaim("u9", "v_bob")).ref(`${BASE}/conversations/c2`).set(conversation("v_bob")));
  });

  it("a customer cannot set server-maintained fields or a closed status", async () => {
    const c = db(anon("cust1"));
    await assertFails(c.ref(`${BASE}/conversations/c2`).set({ ...conversation("cust1"), unread: { customer: 0, agent: 0 } }));
    await assertFails(c.ref(`${BASE}/conversations/c2`).set({ ...conversation("cust1"), lastMessage: { text: "x" } }));
    await assertFails(c.ref(`${BASE}/conversations/c2`).set({ ...conversation("cust1"), status: "closed" }));
    await assertFails(c.ref(`${BASE}/conversations/c2`).set({ ...conversation("cust1"), createdAt: 5 }));
    await assertFails(c.ref(`${BASE}/conversations/c2`).set({ ...conversation("cust1"), assigneeUid: "agentA" }));
  });

  it("a customer cannot modify, close or delete an existing conversation", async () => {
    const c = db(anon("cust1"));
    await assertFails(c.ref(`${BASE}/conversations/c1/status`).set("closed"));
    await assertFails(c.ref(`${BASE}/conversations/c1`).remove());
    await assertFails(c.ref(`${BASE}/conversations/c1/customerId`).set("cust2"));
  });

  it("agents list conversations and change status and assignee", async () => {
    const a = db(user("agentA"));
    await assertSucceeds(a.ref(`${BASE}/conversations`).orderByChild("statusOrder").limitToLast(20).get());
    await assertSucceeds(a.ref(`${BASE}/conversations/c1/status`).set("closed"));
    await assertSucceeds(a.ref(`${BASE}/conversations/c1/assigneeUid`).set("agentA"));
    await assertFails(a.ref(`${BASE}/conversations/c1/assigneeUid`).set("revoked"));
    await assertFails(a.ref(`${BASE}/conversations/c1/status`).set("deleted"));
    await assertFails(a.ref(`${BASE}/conversations/c1/unread`).set({ customer: 0, agent: 0 }));
    await assertFails(a.ref(`${BASE}/conversations/nope/status`).set("closed"));
  });

  it("revoked agents and plain signed-in users get nothing", async () => {
    for (const ctx of [user("revoked"), user("randomUser")]) {
      await assertFails(db(ctx).ref(`${BASE}/conversations`).get());
      await assertFails(db(ctx).ref(`${BASE}/conversations/c1/status`).set("closed"));
      await assertFails(db(ctx).ref(`${BASE}/users/cust1`).get());
    }
  });
});

describe("messages and sender identity", () => {
  it("a customer posts as themselves", async () => {
    await assertSucceeds(db(anon("cust1")).ref(`${BASE}/messages/c1/m1`).set(customerMessage("cust1")));
  });

  it("a customer cannot claim to be an agent or someone else", async () => {
    const c = db(anon("cust1"));
    await assertFails(c.ref(`${BASE}/messages/c1/m1`).set({ ...customerMessage("cust1"), senderType: "agent" }));
    await assertFails(c.ref(`${BASE}/messages/c1/m1`).set({ ...customerMessage("agentA"), senderType: "agent" }));
    await assertFails(c.ref(`${BASE}/messages/c1/m1`).set({ ...customerMessage("cust1"), senderType: "system" }));
    await assertFails(c.ref(`${BASE}/messages/c1/m1`).set(customerMessage("cust2")));
    await assertFails(c.ref(`${BASE}/messages/c1/m1`).set({ ...customerMessage("cust1"), senderName: "Support Team" }));
  });

  it("a customer cannot post into another customer's conversation or a missing one", async () => {
    await assertFails(db(anon("cust2")).ref(`${BASE}/messages/c1/m1`).set(customerMessage("cust2")));
    await assertFails(db(anon("cust2")).ref(`${BASE}/messages/c1/m1`).set(customerMessage("cust1")));
    await assertFails(db(anon("cust1")).ref(`${BASE}/messages/missing/m1`).set(customerMessage("cust1")));
  });

  it("an active agent replies as themselves only", async () => {
    const a = db(user("agentA"));
    const reply = { senderId: "agentA", senderType: "agent", senderName: "Ana", text: "hi!", createdAt: TS };
    await assertSucceeds(a.ref(`${BASE}/messages/c1/m2`).set(reply));
    await assertFails(a.ref(`${BASE}/messages/c1/m3`).set({ ...reply, senderId: "adminA" }));
    await assertFails(a.ref(`${BASE}/messages/c1/m3`).set({ ...reply, senderType: "customer", senderId: "cust1" }));
    await assertFails(a.ref(`${BASE}/messages/c1/m3`).set({ ...reply, senderType: "system", senderId: "system" }));
  });

  it("a signed-in non-agent cannot reply even if it says senderType agent", async () => {
    const reply = { senderId: "randomUser", senderType: "agent", text: "I am support", createdAt: TS };
    await assertFails(db(user("randomUser")).ref(`${BASE}/messages/c1/m2`).set(reply));
    await assertFails(db(user("revoked")).ref(`${BASE}/messages/c1/m2`).set({ ...reply, senderId: "revoked" }));
  });

  it("messages are immutable", async () => {
    await assertFails(db(anon("cust1")).ref(`${BASE}/messages/c1/m0`).set(customerMessage("cust1")));
    await assertFails(db(anon("cust1")).ref(`${BASE}/messages/c1/m0/text`).set("edited"));
    await assertFails(db(anon("cust1")).ref(`${BASE}/messages/c1/m0`).remove());
    await assertFails(db(user("agentA")).ref(`${BASE}/messages/c1/m0`).remove());
  });

  it("validates text, timestamps and unknown fields", async () => {
    const c = db(anon("cust1"));
    await assertFails(c.ref(`${BASE}/messages/c1/m1`).set(customerMessage("cust1", { text: "" })));
    await assertFails(c.ref(`${BASE}/messages/c1/m1`).set(customerMessage("cust1", { text: "x".repeat(4001) })));
    await assertSucceeds(c.ref(`${BASE}/messages/c1/m1`).set(customerMessage("cust1", { text: "x".repeat(4000) })));
    await assertFails(c.ref(`${BASE}/messages/c1/m2`).set(customerMessage("cust1", { createdAt: 123 })));
    await assertFails(c.ref(`${BASE}/messages/c1/m2`).set(customerMessage("cust1", { admin: true })));
    await assertFails(c.ref(`${BASE}/messages/c1/m2`).set({ senderId: "cust1", senderType: "customer", createdAt: TS }));
  });

  it("validates attachments", async () => {
    const c = db(anon("cust1"));
    const prefix = `${BASE}/customers/cust1/conversations/c1/att1`;
    const att = { storagePath: `${prefix}/photo.png`, fileName: "photo.png", contentType: "image/png", size: 1000 };
    const msg = (attachment: Record<string, unknown>) => ({ senderId: "cust1", senderType: "customer", createdAt: TS, attachment });
    await assertSucceeds(c.ref(`${BASE}/messages/c1/a1`).set(msg(att)));
    await assertSucceeds(c.ref(`${BASE}/messages/c1/a3`).set(msg({ ...att, size: 300 * 1024 })));
    await assertFails(c.ref(`${BASE}/messages/c1/a2`).set(msg({ ...att, size: 300 * 1024 + 1 })));
    await assertFails(c.ref(`${BASE}/messages/c1/a2`).set(msg({ ...att, contentType: "application/pdf" })));
    await assertFails(c.ref(`${BASE}/messages/c1/a2`).set(msg({ ...att, contentType: "application/x-msdownload" })));
    await assertFails(
      c.ref(`${BASE}/messages/c1/a2`).set(msg({ ...att, storagePath: `${BASE}/customers/cust2/conversations/c1/x/p.png` })),
    );
    await assertFails(c.ref(`${BASE}/messages/c1/a2`).set(msg({ ...att, url: "https://evil.example" })));
  });
});

describe("role escalation", () => {
  it("nobody can grant themselves a role by writing the database", async () => {
    for (const ctx of [anon("cust1"), user("randomUser"), user("agentA"), user("adminA"), user("revoked")]) {
      const uid = (ctx as unknown as { authUid?: string }).authUid;
      const d = db(ctx);
      await assertFails(d.ref(`${BASE}/agents/randomUser`).set({ role: "admin", active: true }));
      await assertFails(d.ref(`${BASE}/agents/agentA/role`).set("admin"));
      await assertFails(d.ref(`${BASE}/agents/revoked/active`).set(true));
      if (uid) await assertFails(d.ref(`${BASE}/agents/${uid}`).set({ role: "admin", active: true }));
    }
  });

  it("only admins write config", async () => {
    await assertFails(db(user("agentA")).ref(`${BASE}/config/public/welcomeMessage`).set("hi"));
    await assertFails(db(anon("cust1")).ref(`${BASE}/config/public/welcomeMessage`).set("hi"));
    await assertSucceeds(db(user("adminA")).ref(`${BASE}/config/public/welcomeMessage`).set("hi"));
    await assertSucceeds(db(user("adminA")).ref(`${BASE}/config/private/notifyAgents`).set("all"));
    await assertFails(db(user("adminA")).ref(`${BASE}/config/private/notifyAgents`).set("everyone"));
  });

  it("agents read the team list; a user reads only their own agent record", async () => {
    await assertSucceeds(db(user("agentA")).ref(`${BASE}/agents`).get());
    await assertSucceeds(db(user("revoked")).ref(`${BASE}/agents/revoked`).get());
    await assertFails(db(user("revoked")).ref(`${BASE}/agents`).get());
  });

  it("customers cannot write the account fields set by functions", async () => {
    const c = db(anon("cust1"));
    await assertFails(c.ref(`${BASE}/users/cust1/account`).set({ anonymous: false, email: "ceo@example.com" }));
    await assertFails(c.ref(`${BASE}/users/cust1/account/emailVerified`).set(true));
    await assertFails(c.ref(`${BASE}/users/cust1/createdAt`).set(1));
    await assertFails(c.ref(`${BASE}/inbox/cust1/unreadTotal`).set(0));
  });
});

describe("customer properties", () => {
  it("accepts valid properties and rejects invalid ones", async () => {
    const c = db(anon("cust1"));
    await assertSucceeds(c.ref(`${BASE}/users/cust1/properties`).update({ plan: "premium", seats: 3, beta: true }));
    await assertFails(c.ref(`${BASE}/users/cust1/properties`).update({ nested: { a: 1 } }));
    await assertFails(c.ref(`${BASE}/users/cust1/properties`).update({ long: "x".repeat(1001) }));
    await assertFails(c.ref(`${BASE}/users/cust1/properties/${"k".repeat(65)}`).set("v"));
    await assertSucceeds(c.ref(`${BASE}/users/cust1/properties`).update({ _name: "Ada", _email: "ada@example.com", _uid: "u-42" }));
    await assertFails(c.ref(`${BASE}/users/cust1/properties/_uid`).set(42));
    await assertFails(c.ref(`${BASE}/users/cust1/properties/_custom`).set("v"));
    await assertFails(db(anon("cust2")).ref(`${BASE}/users/cust1/properties/plan`).set("free"));
    await assertSucceeds(db(user("agentA")).ref(`${BASE}/users/cust1`).get());
    await assertFails(db(user("agentA")).ref(`${BASE}/users/cust1/properties/plan`).set("free"));
  });
});

describe("read markers", () => {
  it("each side writes its own marker, forward only", async () => {
    const c = db(anon("cust1"));
    await assertSucceeds(c.ref(`${BASE}/reads/c1/customer`).set({ lastReadAt: TS }));
    await assertFails(c.ref(`${BASE}/reads/c1/customer`).set({ lastReadAt: 1 }));
    await assertFails(c.ref(`${BASE}/reads/c1/customer`).set({ lastReadAt: Date.now() + 3_600_000 }));
    await assertFails(c.ref(`${BASE}/reads/c1/agent`).set({ lastReadAt: TS, uid: "cust1" }));
    await assertFails(db(anon("cust2")).ref(`${BASE}/reads/c1/customer`).set({ lastReadAt: TS }));
    const a = db(user("agentA"));
    await assertSucceeds(a.ref(`${BASE}/reads/c1/agent`).set({ lastReadAt: TS, uid: "agentA" }));
    await assertFails(a.ref(`${BASE}/reads/c1/agent`).set({ lastReadAt: TS, uid: "adminA" }));
  });
});

describe("device registrations", () => {
  const reg = (uid: string, extra: Record<string, unknown> = {}) => ({
    uid,
    platform: "ios",
    pushToken: "tok-1",
    active: true,
    updatedAt: TS,
    ...extra,
  });

  it("customers manage only their own registrations", async () => {
    const c = db(anon("cust1"));
    await assertSucceeds(c.ref(`${BASE}/devices/customers/cust1/device-0001`).set(reg("cust1")));
    await assertSucceeds(c.ref(`${BASE}/devices/customers/cust1/device-0001`).update({ pushToken: "tok-2", updatedAt: TS }));
    await assertSucceeds(c.ref(`${BASE}/devices/customers/cust1/device-0002`).set(reg("cust1", { platform: "android" })));
    await assertSucceeds(c.ref(`${BASE}/devices/customers/cust1/device-0001`).remove());
    await assertFails(db(anon("cust2")).ref(`${BASE}/devices/customers/cust1/device-0003`).set(reg("cust2")));
    await assertFails(c.ref(`${BASE}/devices/customers/cust1/device-0003`).set(reg("someoneElse")));
    await assertFails(c.ref(`${BASE}/devices/customers/cust1/device-0003`).set(reg("cust1", { platform: "web" })));
    await assertFails(c.ref(`${BASE}/devices/customers/cust1/bad`).set(reg("cust1")));
    await assertFails(c.ref(`${BASE}/devices/customers/cust1/device-0003`).set(reg("cust1", { extra: 1 })));
  });

  it("customers register devices under their own uid only", async () => {
    const d = db(staleClaim("phoneUid", "v_alice"));
    await assertSucceeds(d.ref(`${BASE}/devices/customers/phoneUid/device-0001`).set(reg("phoneUid")));
    await assertFails(d.ref(`${BASE}/devices/customers/v_alice/device-0001`).set(reg("phoneUid")));
  });

  it("only active agents register agent devices", async () => {
    const r = reg("agentA", { platform: "web" });
    await assertSucceeds(db(user("agentA")).ref(`${BASE}/devices/agents/agentA/browser-0001`).set(r));
    await assertFails(db(user("randomUser")).ref(`${BASE}/devices/agents/randomUser/browser-0001`).set({ ...r, uid: "randomUser" }));
    await assertFails(db(user("agentA")).ref(`${BASE}/devices/agents/adminA/browser-0001`).set(r));
  });

  it("the token index is server-only", async () => {
    await assertFails(db(anon("cust1")).ref(`${BASE}/tokenIndex/abc`).set({ ownerType: "customers", ownerId: "cust1" }));
    await assertFails(db(user("adminA")).ref(`${BASE}/tokenIndex`).get());
  });
});

describe("workspace boundaries", () => {
  it("an agent of one workspace has no access to another", async () => {
    await seed(`clayver/projects/other/conversations/x1`, { customerId: "cust1", status: "open", createdAt: 1 });
    await assertFails(db(user("agentA")).ref(`clayver/projects/other/conversations`).get());
    await assertFails(db(user("agentA")).ref(`clayver/projects/other/conversations/x1/status`).set("closed"));
  });

  it("rejects invalid workspace ids", async () => {
    await assertFails(db(anon("cust1")).ref(`clayver/projects/BAD_ID/conversations/c9`).set(conversation("cust1")));
  });
});

it("sanity: the seeded conversation exists", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    expect((await db(ctx).ref(`${BASE}/conversations/c1/customerId`).get()).val()).toBe("cust1");
  });
});
