/**
 * Rules for the support-team features: tags, conversation tags, internal notes,
 * saved replies, moderation blocks and rate-limit settings.
 */
import { assertFails, assertSucceeds, type RulesTestContext } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { BASE, DB_HOST, NS, resetData, testEnv } from "./env";

const URL = `http://${DB_HOST}?ns=${NS}`;
const db = (ctx: RulesTestContext) => ctx.database(URL);
const TS = { ".sv": "timestamp" };

let env: Awaited<ReturnType<typeof testEnv>>;
const customer = (uid: string) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } });
const user = (uid: string) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "password" } });

async function seed(path: string, value: unknown) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await db(ctx).ref(path).set(value);
  });
}

const tag = (by: string, extra: Record<string, unknown> = {}) => ({ name: "Refund", color: "#16A34A", createdAt: TS, createdBy: by, ...extra });
const note = (by: string, extra: Record<string, unknown> = {}) => ({ authorUid: by, text: "VIP, be nice", createdAt: TS, ...extra });
const reply = (by: string) => ({ title: "Refunds", text: "We've issued a refund.", createdBy: by, createdAt: TS, updatedAt: TS });
const block = (by: string, extra: Record<string, unknown> = {}) => ({ blocked: true, reason: "spam", by, at: TS, ...extra });

beforeAll(async () => {
  env = await testEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await resetData();
  await seed(`${BASE}/agents/agentA`, { role: "agent", active: true });
  await seed(`${BASE}/agents/adminA`, { role: "admin", active: true });
  await seed(`${BASE}/agents/revoked`, { role: "agent", active: false });
  await seed(`${BASE}/conversations/c1`, { customerId: "cust1", status: "open", createdAt: 1 });
  await seed(`${BASE}/tags/todo`, { name: "To do", color: "#2563EB", createdAt: 1, createdBy: "system" });
});

describe("tag catalog", () => {
  it("agents create tags under a slug id; customers and revoked agents can't", async () => {
    await assertSucceeds(db(user("agentA")).ref(`${BASE}/tags/refund`).set(tag("agentA")));
    await assertFails(db(customer("cust1")).ref(`${BASE}/tags/x`).set(tag("cust1")));
    await assertFails(db(user("revoked")).ref(`${BASE}/tags/y`).set(tag("revoked")));
    await assertFails(db(customer("cust1")).ref(`${BASE}/tags`).get());
    await assertSucceeds(db(user("agentA")).ref(`${BASE}/tags`).get());
  });

  it("rejects bad ids, colors, names and forged authors", async () => {
    const a = db(user("agentA"));
    await assertFails(a.ref(`${BASE}/tags/Refund`).set(tag("agentA")));
    await assertFails(a.ref(`${BASE}/tags/-refund`).set(tag("agentA")));
    await assertFails(a.ref(`${BASE}/tags/refund`).set(tag("agentA", { color: "green" })));
    await assertFails(a.ref(`${BASE}/tags/refund`).set(tag("agentA", { name: "" })));
    await assertFails(a.ref(`${BASE}/tags/refund`).set(tag("agentA", { name: "x".repeat(41) })));
    await assertFails(a.ref(`${BASE}/tags/refund`).set(tag("adminA")));
    await assertFails(a.ref(`${BASE}/tags/refund`).set(tag("agentA", { extra: 1 })));
  });

  it("agents rename and recolor but can't rewrite history; only admins delete", async () => {
    const a = db(user("agentA"));
    await assertSucceeds(a.ref(`${BASE}/tags/todo`).update({ name: "Todo", color: "#000000" }));
    await assertFails(a.ref(`${BASE}/tags/todo`).update({ createdBy: "agentA" }));
    await assertFails(a.ref(`${BASE}/tags/todo`).update({ createdAt: 5 }));
    await assertFails(a.ref(`${BASE}/tags/todo`).remove());
    await assertSucceeds(db(user("adminA")).ref(`${BASE}/tags/todo`).remove());
  });
});

describe("conversation tags", () => {
  it("agents tag a conversation with an existing tag only", async () => {
    const a = db(user("agentA"));
    await assertSucceeds(a.ref(`${BASE}/conversationTags/c1/todo`).set(true));
    await assertFails(a.ref(`${BASE}/conversationTags/c1/nope`).set(true));
    await assertFails(a.ref(`${BASE}/conversationTags/ghost/todo`).set(true));
    await assertFails(a.ref(`${BASE}/conversationTags/c1/todo`).set("yes"));
    await assertSucceeds(a.ref(`${BASE}/conversationTags/c1/todo`).remove());
  });

  it("customers can neither see nor set tags, even on their own conversation", async () => {
    await seed(`${BASE}/conversationTags/c1/todo`, true);
    const c = db(customer("cust1"));
    await assertFails(c.ref(`${BASE}/conversationTags/c1`).get());
    await assertFails(c.ref(`${BASE}/conversationTags/c1/todo`).remove());
    await assertFails(c.ref(`${BASE}/tagIndex/todo`).get());
    await assertSucceeds(db(user("agentA")).ref(`${BASE}/tagIndex/todo`).get());
    await assertFails(db(user("agentA")).ref(`${BASE}/tagIndex/todo/c1`).set("open_1"));
  });
});

describe("internal notes", () => {
  it("agents add notes as themselves; customers can't read or write them", async () => {
    await assertSucceeds(db(user("agentA")).ref(`${BASE}/notes/c1/n1`).set(note("agentA", { authorName: "Ann" })));
    await assertFails(db(user("agentA")).ref(`${BASE}/notes/c1/n2`).set(note("adminA")));
    await assertFails(db(user("agentA")).ref(`${BASE}/notes/ghost/n3`).set(note("agentA")));
    await assertFails(db(customer("cust1")).ref(`${BASE}/notes/c1`).get());
    await assertFails(db(customer("cust1")).ref(`${BASE}/notes/c1/n4`).set(note("cust1")));
  });

  it("notes are immutable; the author or an admin deletes", async () => {
    await seed(`${BASE}/notes/c1/n1`, { authorUid: "agentA", text: "x", createdAt: 1 });
    await seed(`${BASE}/agents/agentB`, { role: "agent", active: true });
    await assertFails(db(user("agentA")).ref(`${BASE}/notes/c1/n1/text`).set("edited"));
    await assertFails(db(user("agentB")).ref(`${BASE}/notes/c1/n1`).remove());
    await assertSucceeds(db(user("agentA")).ref(`${BASE}/notes/c1/n1`).remove());
    await seed(`${BASE}/notes/c1/n2`, { authorUid: "agentB", text: "x", createdAt: 1 });
    await assertSucceeds(db(user("adminA")).ref(`${BASE}/notes/c1/n2`).remove());
  });
});

describe("saved replies", () => {
  it("any agent creates and edits; the creator or an admin deletes", async () => {
    await seed(`${BASE}/agents/agentB`, { role: "agent", active: true });
    await assertSucceeds(db(user("agentA")).ref(`${BASE}/savedReplies/r1`).set(reply("agentA")));
    await assertFails(db(user("agentA")).ref(`${BASE}/savedReplies/r2`).set(reply("agentB")));
    await assertSucceeds(db(user("agentB")).ref(`${BASE}/savedReplies/r1`).update({ text: "Updated", updatedAt: TS }));
    await assertFails(db(user("agentB")).ref(`${BASE}/savedReplies/r1`).update({ createdBy: "agentB" }));
    await assertFails(db(user("agentB")).ref(`${BASE}/savedReplies/r1`).remove());
    await assertSucceeds(db(user("agentA")).ref(`${BASE}/savedReplies/r1`).remove());
    await assertFails(db(customer("cust1")).ref(`${BASE}/savedReplies`).get());
  });
});

describe("moderation", () => {
  it("agents block and unblock; customers read only their own block", async () => {
    await assertSucceeds(db(user("agentA")).ref(`${BASE}/moderation/cust1`).set(block("agentA")));
    await assertFails(db(user("agentA")).ref(`${BASE}/moderation/cust2`).set(block("system")));
    await assertFails(db(user("agentA")).ref(`${BASE}/moderation/cust2`).set(block("agentA", { reason: "rude" })));
    await assertFails(db(user("agentA")).ref(`${BASE}/moderation/cust2`).set(block("agentA", { reason: "rate_limit" })));
    await assertFails(db(user("agentA")).ref(`${BASE}/moderation/cust2`).set(block("agentA", { until: 5 })));
    await assertSucceeds(db(customer("cust1")).ref(`${BASE}/moderation/cust1`).get());
    await assertFails(db(customer("cust2")).ref(`${BASE}/moderation/cust1`).get());
    await assertFails(db(customer("cust1")).ref(`${BASE}/moderation/cust1`).remove());
    await assertSucceeds(db(user("agentA")).ref(`${BASE}/moderation/cust1`).remove());
  });

  it("a blocked customer can't create conversations or send messages, but can still read", async () => {
    await seed(`${BASE}/moderation/cust1`, { blocked: true, reason: "spam", by: "agentA", at: 1 });
    const c = db(customer("cust1"));
    await assertFails(c.ref(`${BASE}/conversations/c2`).set({ customerId: "cust1", status: "open", createdAt: TS }));
    await assertFails(c.ref(`${BASE}/messages/c1/m1`).set({ senderId: "cust1", senderType: "customer", text: "hi", createdAt: TS }));
    await assertSucceeds(c.ref(`${BASE}/conversations/c1`).get());
    // Agents can still reply.
    await assertSucceeds(
      db(user("agentA")).ref(`${BASE}/messages/c1/m2`).set({ senderId: "agentA", senderType: "agent", text: "ok", createdAt: TS }),
    );
  });

  it("an expired block no longer applies", async () => {
    await seed(`${BASE}/moderation/cust1`, { blocked: true, reason: "rate_limit", until: Date.now() - 1000, by: "system", at: 1 });
    await assertSucceeds(
      db(customer("cust1")).ref(`${BASE}/messages/c1/m1`).set({ senderId: "cust1", senderType: "customer", text: "hi", createdAt: TS }),
    );
  });
});

describe("rate limit settings", () => {
  it("admins set them within bounds; agents read them", async () => {
    const admin = db(user("adminA"));
    await assertSucceeds(admin.ref(`${BASE}/config/private/rateLimits`).set({ messagesPerMinute: 60, conversationsPerHour: 5 }));
    await assertFails(admin.ref(`${BASE}/config/private/rateLimits`).set({ messagesPerMinute: 0 }));
    await assertFails(admin.ref(`${BASE}/config/private/rateLimits`).set({ other: 1 }));
    await assertFails(db(user("agentA")).ref(`${BASE}/config/private/rateLimits/messagesPerMinute`).set(10));
    await assertSucceeds(db(user("agentA")).ref(`${BASE}/config/private/rateLimits`).get());
  });
});
