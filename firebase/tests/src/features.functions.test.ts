/**
 * Support-team features against the Auth, Database, Storage and Functions emulators:
 * several conversations per customer, default tags and the tag index, automatic
 * rate limits, and customer data export and deletion.
 */
import { get, push, ref, remove, serverTimestamp, set, update } from "firebase/database";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { anonymousClient, passwordClient, read, registerDevice, sendAgentMessage, sendCustomerMessage, startConversation, type Client } from "./client";
import { adminDb, BASE, eventually, resetData, testEnv } from "./env";

// The default bucket Cloud Functions see in the emulator (production: the project's default bucket).
const BUCKET = "gs://demo-clayver.appspot.com";
const clients: Client[] = [];
const track = <T extends Client>(c: T) => (clients.push(c), c);
const val = async (path: string) => (await adminDb().ref(`${BASE}/${path}`).get()).val();

async function setupTeam() {
  const owner = track(await passwordClient("owner@example.com"));
  await owner.call("clayverBootstrapAdmin", {});
  await owner.auth.currentUser!.getIdToken(true);
  const res = await owner.call<{ uid: string }>("clayverSetAgentRole", { email: "agent@example.com", role: "agent" });
  const agent = track(await passwordClient("agent@example.com"));
  expect(agent.uid).toBe(res.uid);
  return { owner, agent };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code: `functions/${code}` });
}

beforeAll(async () => {
  await testEnv();
  await resetData();
});
beforeEach(async () => {
  await resetData();
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

describe("several conversations per customer", () => {
  it("each conversation is its own thread in the customer's inbox", async () => {
    const { agent } = await setupTeam();
    const phone = track(await anonymousClient());
    const first = await startConversation(phone, phone.uid, "Order missing");
    const second = await startConversation(phone, phone.uid, "Also, how do I change my email?");
    expect(first).not.toBe(second);
    await sendAgentMessage(agent, first, "Looking into the order");
    await sendAgentMessage(agent, second, "Settings > Account");
    await sendAgentMessage(agent, second, "Let me know if that works");

    const inbox = await eventually(async () => {
      const v = await read(phone, `${BASE}/inbox/${phone.uid}`);
      return v?.unreadTotal === 3 && v.conversations[second].lastMessage?.text === "Let me know if that works" ? v : null;
    });
    expect(inbox.conversations[first].unread).toBe(1);
    expect(inbox.conversations[second].unread).toBe(2);
    expect(inbox.conversations[second].lastMessage.text).toBe("Let me know if that works");

    // Closing one leaves the other open.
    await set(ref(agent.db, `${BASE}/conversations/${first}/status`), "closed");
    await eventually(async () => (await read(phone, `${BASE}/inbox/${phone.uid}/conversations/${first}/status`)) === "closed");
    expect(await read(phone, `${BASE}/inbox/${phone.uid}/conversations/${second}/status`)).toBe("open");
  });
});

describe("tags", () => {
  it("claiming the first admin seat seeds the default tags once", async () => {
    await setupTeam();
    const tags = await eventually(async () => val("tags"));
    expect(Object.keys(tags)).toEqual(
      expect.arrayContaining(["to-do", "in-progress", "waiting-on-customer", "on-hold", "urgent", "bug", "feature-request", "billing", "account", "feedback"]),
    );
    expect(tags["to-do"]).toMatchObject({ name: "To do", color: "#2563EB", createdBy: "system" });
    // A tag the team deletes stays deleted.
    await adminDb().ref(`${BASE}/tags/feedback`).remove();
    const phone = track(await anonymousClient());
    await startConversation(phone, phone.uid);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await val("tags/feedback")).toBeNull();
  });

  it("tagIndex follows the conversation's status, and deleting a tag untags everything", async () => {
    const { owner, agent } = await setupTeam();
    await eventually(async () => val("tags/urgent"));
    const phone = track(await anonymousClient());
    const c1 = await startConversation(phone, phone.uid, "Payment failed");
    const c2 = await startConversation(phone, phone.uid, "App crashes");

    await set(ref(agent.db, `${BASE}/conversationTags/${c1}/urgent`), true);
    await set(ref(agent.db, `${BASE}/conversationTags/${c2}/urgent`), true);
    await set(ref(agent.db, `${BASE}/conversationTags/${c2}/bug`), true);
    await eventually(async () => String((await val(`tagIndex/urgent/${c1}`)) ?? "").startsWith("open_"));
    await eventually(async () => String((await val(`tagIndex/bug/${c2}`)) ?? "").startsWith("open_"));

    // The filtered inbox query the clients use.
    const openUrgent = await get(
      ref(agent.db, `${BASE}/tagIndex/urgent`),
    ).then((s) => Object.keys(s.val() ?? {}).sort());
    expect(openUrgent).toEqual([c1, c2].sort());

    await set(ref(agent.db, `${BASE}/conversations/${c1}/status`), "closed");
    await eventually(async () => String((await val(`tagIndex/urgent/${c1}`)) ?? "").startsWith("closed_"));
    // A new customer message reopens it and the index follows.
    await sendCustomerMessage(phone, c1, phone.uid, "Still failing");
    await eventually(async () => String((await val(`tagIndex/urgent/${c1}`)) ?? "").startsWith("open_"));

    await remove(ref(agent.db, `${BASE}/conversationTags/${c2}/bug`));
    await eventually(async () => (await val(`tagIndex/bug/${c2}`)) === null);

    await remove(ref(owner.db, `${BASE}/tags/urgent`));
    await eventually(async () => (await val(`conversationTags/${c1}/urgent`)) === null && (await val(`conversationTags/${c2}/urgent`)) === null);
    await eventually(async () => (await val("tagIndex/urgent")) === null);
  });
});

describe("automatic rate limits", () => {
  it("too many messages in a minute blocks the customer for a while", async () => {
    const { owner } = await setupTeam();
    await set(ref(owner.db, `${BASE}/config/private/rateLimits`), { messagesPerMinute: 3, conversationsPerHour: 10 });
    const phone = track(await anonymousClient());
    const c = await startConversation(phone, phone.uid, "1");
    for (const text of ["2", "3", "4"]) await sendCustomerMessage(phone, c, phone.uid, text);
    const block = await eventually(async () => read(phone, `${BASE}/moderation/${phone.uid}`));
    expect(block).toMatchObject({ blocked: true, reason: "rate_limit", by: "system" });
    expect(block.until).toBeGreaterThan(Date.now() + 9 * 60_000);
    await expect(sendCustomerMessage(phone, c, phone.uid, "5")).rejects.toThrow();
  });

  it("too many new conversations in an hour blocks the customer, but never replaces a manual block", async () => {
    const { owner, agent } = await setupTeam();
    await set(ref(owner.db, `${BASE}/config/private/rateLimits`), { messagesPerMinute: 100, conversationsPerHour: 2 });
    const phone = track(await anonymousClient());
    await startConversation(phone, phone.uid, "a");
    await startConversation(phone, phone.uid, "b");
    await new Promise((r) => setTimeout(r, 1000));
    expect(await val(`moderation/${phone.uid}`)).toBeNull();
    await startConversation(phone, phone.uid, "c");
    const block = await eventually(async () => val(`moderation/${phone.uid}`));
    expect(block.reason).toBe("rate_limit");

    // A permanent manual block on someone else survives their going over the limit.
    const other = track(await anonymousClient());
    await startConversation(other, other.uid, "a");
    await startConversation(other, other.uid, "b");
    await set(ref(agent.db, `${BASE}/moderation/${other.uid}`), { blocked: true, reason: "spam", by: agent.uid, at: serverTimestamp() });
    const conv = push(ref(other.db, `${BASE}/conversations`));
    await expect(set(conv, { customerId: other.uid, status: "open", createdAt: serverTimestamp() })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 1000));
    expect(await val(`moderation/${other.uid}`)).toMatchObject({ reason: "spam", by: agent.uid });
  });
});

describe("customer data export and deletion", () => {
  async function customerWithHistory(agent: Client) {
    const phone = track(await anonymousClient());
    await update(ref(phone.db, `${BASE}/users/${phone.uid}/properties`), { _name: "Ada", _email: "ada@example.com" });
    await registerDevice(phone, { type: "customers", id: phone.uid }, "device-ada-1", "token-ada-1");
    const c1 = await startConversation(phone, phone.uid, "First issue");
    const c2 = await startConversation(phone, phone.uid, "Second issue");
    await sendAgentMessage(agent, c1, "On it");
    await set(push(ref(agent.db, `${BASE}/notes/${c1}`)), { authorUid: agent.uid, text: "Refund approved", createdAt: serverTimestamp() });
    await eventually(async () => val("tags/billing"));
    await set(ref(agent.db, `${BASE}/conversationTags/${c1}/billing`), true);
    await eventually(async () => val(`tagIndex/billing/${c1}`));
    await eventually(async () => val(`tokenIndex`));
    const env = await testEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .storage(BUCKET)
        .ref(`${BASE}/customers/${phone.uid}/conversations/${c1}/att1/receipt.png`)
        .put(new Uint8Array([137, 80, 78, 71]), { contentType: "image/png" });
    });
    return { phone, c1, c2 };
  }

  it("admins export a customer's data as JSON; agents can't", async () => {
    const { owner, agent } = await setupTeam();
    const { phone, c1, c2 } = await customerWithHistory(agent);
    await expectCode(agent.call("clayverExportCustomer", { customerId: phone.uid }), "permission-denied");
    const out = await owner.call<any>("clayverExportCustomer", { customerId: phone.uid });
    expect(out.customer).toMatchObject({ customerId: phone.uid, properties: { _name: "Ada" } });
    expect(out.customer.devices[0]).toMatchObject({ deviceId: "device-ada-1", platform: "ios" });
    expect(JSON.stringify(out)).not.toContain("token-ada-1");
    expect(out.conversations.map((c: any) => c.id)).toEqual([c1, c2]);
    const first = out.conversations[0];
    expect(first.tags).toEqual(["billing"]);
    expect(first.notes[0].text).toBe("Refund approved");
    expect(first.messages.map((m: any) => m.text)).toEqual(expect.arrayContaining(["First issue", "On it"]));
  });

  it("a customer deletes their own data, and nobody else's", async () => {
    const { agent } = await setupTeam();
    const { phone, c1, c2 } = await customerWithHistory(agent);
    const bystander = track(await anonymousClient());
    const keep = await startConversation(bystander, bystander.uid, "Unrelated");

    await bystander.call("clayverDeleteMyData", {});
    expect(await val(`conversations/${c1}`)).not.toBeNull(); // only the caller's own data went
    await bystander.call("clayverDeleteMyData", {}); // idempotent

    await phone.call("clayverDeleteMyData", {});
    for (const path of [
      `conversations/${c1}`, `conversations/${c2}`, `messages/${c1}`, `reads/${c1}`, `notes/${c1}`,
      `conversationTags/${c1}`, `tagIndex/billing/${c1}`, `users/${phone.uid}`, `inbox/${phone.uid}`,
      `devices/customers/${phone.uid}`, `limits/${phone.uid}`,
    ]) {
      expect(await val(path), path).toBeNull();
    }
    expect(await val("tokenIndex")).toBeNull();
    expect(await val(`conversations/${keep}`)).toBeNull(); // the bystander deleted their own
    const env = await testEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await expect(
        ctx.storage(BUCKET).ref(`${BASE}/customers/${phone.uid}/conversations/${c1}/att1/receipt.png`).getMetadata(),
      ).rejects.toThrow();
    });
  });

  it("only admins delete a customer", async () => {
    const { owner, agent } = await setupTeam();
    const { phone, c1 } = await customerWithHistory(agent);
    await expectCode(agent.call("clayverDeleteCustomer", { customerId: phone.uid }), "permission-denied");
    await expectCode(owner.call("clayverDeleteCustomer", { customerId: "a/b" }), "invalid-argument");
    await owner.call("clayverDeleteCustomer", { customerId: phone.uid });
    expect(await val(`conversations/${c1}`)).toBeNull();
    expect(await val(`users/${phone.uid}`)).toBeNull();
  });
});
