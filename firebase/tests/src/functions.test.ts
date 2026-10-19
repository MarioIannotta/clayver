/**
 * End-to-end tests against the Auth, Database and Functions emulators:
 * customer identity, role management, message fan-out, unread counters,
 * concurrency and the push-token lifecycle.
 */
import { ref, serverTimestamp, set, update } from "firebase/database";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  anonymousClient,
  passwordClient,
  read,
  registerDevice,
  sendAgentMessage,
  sendCustomerMessage,
  startConversation,
  type Client,
} from "./client";
import { adminAuth, adminDb, BASE, eventually, resetData, testEnv } from "./env";

const clients: Client[] = [];
const track = <T extends Client>(c: T) => (clients.push(c), c);

async function pushes(): Promise<Array<{ token: string; data: Record<string, string>; notification: { title: string } }>> {
  return Object.values((await adminDb().ref("clayverEmulator/pushes/default").get()).val() ?? {});
}

/** Owner bootstraps the workspace and invites one agent. */
async function setupTeam() {
  const owner = track(await passwordClient("owner@example.com"));
  await owner.call("clayverBootstrapAdmin", {});
  await owner.auth.currentUser!.getIdToken(true);
  const agentRes = await owner.call<{ uid: string }>("clayverSetAgentRole", { email: "agent@example.com", role: "agent" });
  const agent = track(await passwordClient("agent@example.com"));
  expect(agent.uid).toBe(agentRes.uid);
  return { owner, agent };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code: `functions/${code}` });
}

beforeAll(async () => {
  await testEnv(); // loads the database and storage rules into the emulator namespace
  await resetData();
});
beforeEach(async () => {
  await resetData();
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

describe("customer identity", () => {
  it("a signed-in Firebase user is the customer, keyed by uid, and their account is recorded", async () => {
    const user = track(await passwordClient("customer@example.com"));
    const conv = await startConversation(user, user.uid, "hi");
    expect(await read(user, `${BASE}/conversations/${conv}/customerId`)).toBe(user.uid);
    const account = await eventually(async () => (await adminDb().ref(`${BASE}/users/${user.uid}/account`).get()).val());
    expect(account).toMatchObject({ anonymous: false, email: "customer@example.com", emailVerified: true });
  });

  it("anonymous visitors are recorded as anonymous", async () => {
    const visitor = track(await anonymousClient());
    await startConversation(visitor, visitor.uid);
    const account = await eventually(async () => (await adminDb().ref(`${BASE}/users/${visitor.uid}/account`).get()).val());
    expect(account).toMatchObject({ anonymous: true, email: null });
  });

  it("a customer cannot act as someone else or read their conversation", async () => {
    const victim = track(await passwordClient("victim@example.com"));
    const conv = await startConversation(victim, victim.uid, "my private issue");

    const attacker = track(await anonymousClient());
    await expect(startConversation(attacker, victim.uid)).rejects.toThrow(/permission/i);
    await expect(read(attacker, `${BASE}/conversations/${conv}`)).rejects.toThrow(/permission/i);
    await expect(read(attacker, `${BASE}/messages/${conv}`)).rejects.toThrow(/permission/i);
  });

  it("a leftover clayver_cid claim grants nothing", async () => {
    const victim = track(await passwordClient("victim2@example.com"));
    const conv = await startConversation(victim, victim.uid, "mine");
    const attacker = track(await anonymousClient());
    await adminAuth().setCustomUserClaims(attacker.uid, { clayver_cid: victim.uid });
    await attacker.auth.currentUser!.getIdToken(true);
    await expect(read(attacker, `${BASE}/conversations/${conv}`)).rejects.toThrow(/permission/i);
  });

  it("two devices signed in to the same account share conversations and unread counts", async () => {
    const phone = track(await passwordClient("multi@example.com"));
    const tablet = track(await passwordClient("multi@example.com"));
    const cid = phone.uid;
    expect(tablet.uid).toBe(cid);
    const conv = await startConversation(phone, cid);
    expect(await read(tablet, `${BASE}/conversations/${conv}/customerId`)).toBe(cid);
    await eventually(async () => (await read(tablet, `${BASE}/inbox/${cid}/conversations/${conv}`)) != null);
  });
});

describe("roles", () => {
  it("bootstrap needs a listed, verified email and only works once", async () => {
    const stranger = track(await passwordClient("stranger@example.com"));
    await expectCode(stranger.call("clayverBootstrapAdmin", {}), "permission-denied");

    const unverified = track(await passwordClient("owner@example.com", { verified: false }));
    await adminAuth().updateUser(unverified.uid, { emailVerified: false });
    await unverified.auth.currentUser!.getIdToken(true);
    await expectCode(unverified.call("clayverBootstrapAdmin", {}), "permission-denied");
    await adminAuth().updateUser(unverified.uid, { emailVerified: true });
    await unverified.auth.currentUser!.getIdToken(true);
    await expect(unverified.call("clayverBootstrapAdmin", {})).resolves.toEqual({ role: "admin" });

    const anon = track(await anonymousClient());
    await expectCode(anon.call("clayverBootstrapAdmin", {}), "permission-denied");
    const token = await unverified.auth.currentUser!.getIdTokenResult(true);
    expect(token.claims.clayver_roles).toEqual({ default: "admin" });
  });

  it("a second bootstrap is refused once an admin exists", async () => {
    await setupTeam();
    const second = track(await passwordClient("second@example.com"));
    await expectCode(second.call("clayverBootstrapAdmin", {}), "failed-precondition");
    expect((await adminDb().ref(`${BASE}/agents/${second.uid}`).get()).val()).toBeNull();
  });

  it("admins grant and revoke agents; access follows immediately", async () => {
    const { owner, agent } = await setupTeam();
    const customer = track(await anonymousClient());
    const conv = await startConversation(customer, customer.uid);

    await eventually(async () => (await read(agent, `${BASE}/conversations/${conv}/customerId`)) === customer.uid);
    const claims = (await agent.auth.currentUser!.getIdTokenResult(true)).claims;
    expect(claims.clayver_roles).toEqual({ default: "agent" });

    await owner.call("clayverSetAgentRole", { uid: agent.uid, role: "none" });
    await expect(read(agent, `${BASE}/conversations/${conv}`)).rejects.toThrow(/permission/i);
    const record = (await adminDb().ref(`${BASE}/agents/${agent.uid}`).get()).val();
    expect(record.active).toBe(false);
    expect((await adminAuth().getUser(agent.uid)).customClaims?.clayver_roles).toBeUndefined();
  });

  it("inviting an unknown email creates the account and returns a setup link", async () => {
    const { owner } = await setupTeam();
    const res = await owner.call<{ uid: string; role: string; inviteLink?: string }>("clayverSetAgentRole", {
      email: "new.hire@example.com",
      role: "agent",
      displayName: "New Hire",
    });
    expect(res.role).toBe("agent");
    expect(res.inviteLink).toMatch(/^https?:\/\//);
    expect((await adminDb().ref(`${BASE}/agents/${res.uid}`).get()).val()).toMatchObject({
      role: "agent",
      active: true,
      displayName: "New Hire",
    });
  });

  it("agents and customers cannot grant roles (escalation attempts)", async () => {
    const { agent } = await setupTeam();
    await expectCode(agent.call("clayverSetAgentRole", { uid: agent.uid, role: "admin" }), "permission-denied");
    const customer = track(await anonymousClient());
    await expectCode(customer.call("clayverSetAgentRole", { uid: customer.uid, role: "agent" }), "permission-denied");
    await expect(
      set(ref(customer.db, `${BASE}/agents/${customer.uid}`), { role: "admin", active: true }),
    ).rejects.toThrow(/permission/i);
    // A forged role claim alone does not open the database (roles live in the database).
    await adminAuth().setCustomUserClaims(customer.uid, { clayver_roles: { default: "admin" } });
    await customer.auth.currentUser!.getIdToken(true);
    await expect(read(customer, `${BASE}/conversations`)).rejects.toThrow(/permission/i);
  });

  it("the last admin cannot be removed or demoted", async () => {
    const { owner } = await setupTeam();
    await expectCode(owner.call("clayverSetAgentRole", { uid: owner.uid, role: "agent" }), "failed-precondition");
    await expectCode(owner.call("clayverSetAgentRole", { uid: owner.uid, role: "none" }), "failed-precondition");
  });

  it("validates arguments", async () => {
    const { owner } = await setupTeam();
    await expectCode(owner.call("clayverSetAgentRole", { email: "x@example.com", role: "superuser" }), "invalid-argument");
    await expectCode(owner.call("clayverSetAgentRole", { role: "agent" }), "invalid-argument");
    await expectCode(owner.call("clayverSetAgentRole", { email: "not-an-email", role: "agent" }), "invalid-argument");
    await expectCode(owner.call("clayverSetAgentRole", { projectId: "Bad Id", email: "x@example.com", role: "agent" }), "invalid-argument");
  });
});

describe("messaging, statuses and unread counts", () => {
  it("customer and agent exchange messages with counters, inbox and read receipts", async () => {
    const { agent } = await setupTeam();
    const customer = track(await anonymousClient());
    const cid = customer.uid;
    const conv = await startConversation(customer, cid, "first");

    const c1 = await eventually(async () => {
      const c = await read(agent, `${BASE}/conversations/${conv}`);
      return c?.lastMessage?.text === "first" && c.unread?.agent === 1 ? c : null;
    });
    expect(c1.statusOrder).toMatch(/^open_\d{15}$/);
    expect(c1.unread.customer).toBe(0);

    await sendAgentMessage(agent, conv, "hi, how can I help?");
    await eventually(async () => (await read(customer, `${BASE}/inbox/${cid}/unreadTotal`)) === 1);
    expect(await read(customer, `${BASE}/inbox/${cid}/conversations/${conv}/lastMessage/text`)).toBe("hi, how can I help?");

    // Read receipts: both sides mark read, counters drop to zero.
    await set(ref(customer.db, `${BASE}/reads/${conv}/customer`), { lastReadAt: serverTimestamp() });
    await set(ref(agent.db, `${BASE}/reads/${conv}/agent`), { lastReadAt: serverTimestamp(), uid: agent.uid });
    await eventually(async () => (await read(customer, `${BASE}/inbox/${cid}/unreadTotal`)) === 0);
    await eventually(async () => (await read(agent, `${BASE}/conversations/${conv}/unread/agent`)) === 0);
    const reads = await read(customer, `${BASE}/reads/${conv}`);
    expect(reads.agent.lastReadAt).toBeGreaterThanOrEqual(c1.lastMessage.createdAt);
  });

  it("agents close conversations and a new customer message reopens them", async () => {
    const { agent } = await setupTeam();
    const customer = track(await anonymousClient());
    const conv = await startConversation(customer, customer.uid);
    await eventually(async () => (await read(agent, `${BASE}/conversations/${conv}/rev`)) >= 2);

    await set(ref(agent.db, `${BASE}/conversations/${conv}/status`), "closed");
    await eventually(async () => {
      const c = await read(agent, `${BASE}/conversations/${conv}`);
      return c.statusOrder.startsWith("closed_") && typeof c.closedAt === "number";
    });
    await eventually(async () => (await read(customer, `${BASE}/inbox/${customer.uid}/conversations/${conv}/status`)) === "closed");

    await sendCustomerMessage(customer, conv, customer.uid, "still broken");
    await eventually(async () => {
      const c = await read(agent, `${BASE}/conversations/${conv}`);
      return c.status === "open" && c.statusOrder.startsWith("open_") && !c.closedAt;
    });
  });

  it("paginates history by key", async () => {
    const customer = track(await anonymousClient());
    const conv = await startConversation(customer, customer.uid, "m0");
    for (let i = 1; i < 12; i++) await sendCustomerMessage(customer, conv, customer.uid, `m${i}`);
    const { query, ref: r, orderByKey, limitToLast, endBefore, get } = await import("firebase/database");
    const page1 = await get(query(r(customer.db, `${BASE}/messages/${conv}`), orderByKey(), limitToLast(5)));
    const keys1 = Object.keys(page1.val());
    expect(Object.values(page1.val()).map((m: any) => m.text)).toEqual(["m7", "m8", "m9", "m10", "m11"]);
    const page2 = await get(query(r(customer.db, `${BASE}/messages/${conv}`), orderByKey(), endBefore(keys1[0]), limitToLast(5)));
    expect(Object.values(page2.val()).map((m: any) => m.text)).toEqual(["m2", "m3", "m4", "m5", "m6"]);
  });

  it("concurrent messages from several devices produce exact unread counts", async () => {
    const { agent } = await setupTeam();
    const phone = track(await passwordClient("busy@example.com"));
    const tablet = track(await passwordClient("busy@example.com"));
    const cid = phone.uid;
    const conv = await startConversation(phone, cid, "start");

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => sendCustomerMessage(i % 2 ? phone : tablet, conv, cid, `burst ${i}`)),
    );
    const agent2 = agent; // replies race with customer messages
    await Promise.all(Array.from({ length: 10 }, (_, i) => sendAgentMessage(agent2, conv, `reply ${i}`)));

    await eventually(async () => (await read(agent, `${BASE}/conversations/${conv}/unread/agent`)) === 21, 30_000);
    await eventually(async () => (await read(phone, `${BASE}/inbox/${cid}/unreadTotal`)) === 10, 30_000);

    // Reading on one device clears the count everywhere.
    await set(ref(tablet.db, `${BASE}/reads/${conv}/customer`), { lastReadAt: serverTimestamp() });
    await eventually(async () => (await read(phone, `${BASE}/inbox/${cid}/unreadTotal`)) === 0, 30_000);
    // And it stays settled (no late, stale writer moves it back).
    await new Promise((r) => setTimeout(r, 1500));
    expect(await read(phone, `${BASE}/inbox/${cid}/unreadTotal`)).toBe(0);
    expect(await read(agent, `${BASE}/conversations/${conv}/unread/agent`)).toBe(21);
  });

  it("unread totals sum across conversations", async () => {
    const { agent } = await setupTeam();
    const customer = track(await anonymousClient());
    const a = await startConversation(customer, customer.uid, "a");
    const b = await startConversation(customer, customer.uid, "b");
    await sendAgentMessage(agent, a, "reply a");
    await sendAgentMessage(agent, b, "reply b1");
    await sendAgentMessage(agent, b, "reply b2");
    await eventually(async () => (await read(customer, `${BASE}/inbox/${customer.uid}/unreadTotal`)) === 3);
  });

  it("posts the workspace welcome message without counting it as unread", async () => {
    const { owner } = await setupTeam();
    await set(ref(owner.db, `${BASE}/config/public/welcomeMessage`), "Hi! We usually reply within a day.");
    const customer = track(await anonymousClient());
    const conv = await startConversation(customer, customer.uid);
    await eventually(async () => {
      const msgs = Object.values((await read(customer, `${BASE}/messages/${conv}`)) ?? {}) as any[];
      return msgs.some((m) => m.senderType === "system" && m.text.startsWith("Hi!"));
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(await read(customer, `${BASE}/inbox/${customer.uid}/unreadTotal`)).toBe(0);
  });

  it("customer properties are visible to agents", async () => {
    const { agent } = await setupTeam();
    const customer = track(await anonymousClient());
    await update(ref(customer.db, `${BASE}/users/${customer.uid}/properties`), { plan: "premium", appVersion: "1.2.0" });
    expect(await read(agent, `${BASE}/users/${customer.uid}/properties`)).toEqual({ plan: "premium", appVersion: "1.2.0" });
  });
});

describe("push notifications and device registrations", () => {
  it("agent replies notify every customer device, not the agent", async () => {
    const { agent } = await setupTeam();
    const phone = track(await passwordClient("push@example.com"));
    const tablet = track(await passwordClient("push@example.com"));
    const cid = phone.uid;
    await registerDevice(phone, { type: "customers", id: cid }, "phone-device-1", "tok-phone");
    await registerDevice(tablet, { type: "customers", id: cid }, "tablet-device-1", "tok-tablet", "android");
    await registerDevice(agent, { type: "agents", id: agent.uid }, "agent-browser-1", "tok-agent", "web");
    const conv = await startConversation(phone, cid);

    // Customer message -> the agent's device only.
    await eventually(async () => (await pushes()).some((p) => p.token === "tok-agent"));
    expect((await pushes()).filter((p) => p.token.startsWith("tok-phone") || p.token === "tok-tablet")).toHaveLength(0);

    await sendAgentMessage(agent, conv, "We're on it");
    const toCustomer = await eventually(async () => {
      const ps = (await pushes()).filter((p) => p.token === "tok-phone" || p.token === "tok-tablet");
      return ps.length === 2 ? ps : null;
    });
    for (const p of toCustomer) {
      expect(p.data).toMatchObject({ clayver: "1", type: "message", projectId: "default", conversationId: conv });
      expect(p.data.link).toBe(`clayver://conversation/${conv}`);
    }
    await new Promise((r) => setTimeout(r, 800));
    expect((await pushes()).filter((p) => p.token === "tok-agent")).toHaveLength(1);
  });

  it("does not notify twice for the same token and respects preferences", async () => {
    const { agent, owner } = await setupTeam();
    // Same token registered twice by the same customer (e.g. reinstall with a new device id).
    const customer = track(await anonymousClient());
    await registerDevice(customer, { type: "customers", id: customer.uid }, "install-aaaa-1", "tok-dup");
    await registerDevice(customer, { type: "customers", id: customer.uid }, "install-bbbb-2", "tok-dup");
    // The owner opted out of push.
    await registerDevice(owner, { type: "agents", id: owner.uid }, "owner-browser-1", "tok-owner", "web");
    await set(ref(owner.db, `${BASE}/agentSettings/${owner.uid}/notifications/push`), false);
    await registerDevice(agent, { type: "agents", id: agent.uid }, "agent-browser-1", "tok-agent", "web");

    const conv = await startConversation(customer, customer.uid);
    await eventually(async () => (await pushes()).some((p) => p.token === "tok-agent"));
    await sendAgentMessage(agent, conv, "reply");
    await eventually(async () => (await pushes()).some((p) => p.token === "tok-dup"));
    await new Promise((r) => setTimeout(r, 800));
    expect((await pushes()).filter((p) => p.token === "tok-dup")).toHaveLength(1);
    expect((await pushes()).filter((p) => p.token === "tok-owner")).toHaveLength(0);

    // Customer turns notifications off.
    await set(ref(customer.db, `${BASE}/users/${customer.uid}/notifications/enabled`), false);
    await sendAgentMessage(agent, conv, "second reply");
    await eventually(async () => (await read(customer, `${BASE}/inbox/${customer.uid}/unreadTotal`)) === 2);
    await new Promise((r) => setTimeout(r, 800));
    expect((await pushes()).filter((p) => p.token === "tok-dup")).toHaveLength(1);
  });

  it("assigned conversations notify only the assignee", async () => {
    const { agent, owner } = await setupTeam();
    await registerDevice(owner, { type: "agents", id: owner.uid }, "owner-browser-1", "tok-owner", "web");
    await registerDevice(agent, { type: "agents", id: agent.uid }, "agent-browser-1", "tok-agent", "web");
    const customer = track(await anonymousClient());
    const conv = await startConversation(customer, customer.uid);
    await eventually(async () => (await pushes()).filter((p) => p.token.startsWith("tok-")).length === 2);
    await set(ref(agent.db, `${BASE}/conversations/${conv}/assigneeUid`), agent.uid);
    await sendCustomerMessage(customer, conv, customer.uid, "follow-up");
    await eventually(async () => (await pushes()).filter((p) => p.token === "tok-agent").length === 2);
    await new Promise((r) => setTimeout(r, 800));
    expect((await pushes()).filter((p) => p.token === "tok-owner")).toHaveLength(1);
  });

  it("invalid tokens are deactivated and dropped from the index", async () => {
    const { agent } = await setupTeam();
    const customer = track(await anonymousClient());
    await registerDevice(customer, { type: "customers", id: customer.uid }, "stale-device-1", "invalid-token-1");
    const conv = await startConversation(customer, customer.uid);
    await sendAgentMessage(agent, conv, "reply");
    const reg = await eventually(async () => {
      const d = await read(customer, `${BASE}/devices/customers/${customer.uid}/stale-device-1`);
      return d?.active === false ? d : null;
    });
    expect(typeof reg.invalidatedAt).toBe("number");
    await eventually(async () => (await adminDb().ref(`${BASE}/tokenIndex`).get()).val() === null);
  });

  it("token refresh replaces the old token; a token moving to a new user leaves the old one", async () => {
    const phone = track(await passwordClient("alice@example.com"));
    const cidA = phone.uid;
    await registerDevice(phone, { type: "customers", id: cidA }, "phone-device-1", "tok-v1");
    await eventually(async () => Object.keys((await adminDb().ref(`${BASE}/tokenIndex`).get()).val() ?? {}).length === 1);

    // Refresh: same device id, new token.
    await update(ref(phone.db, `${BASE}/devices/customers/${cidA}/phone-device-1`), { pushToken: "tok-v2", updatedAt: serverTimestamp() });
    await eventually(async () => {
      const idx = Object.values((await adminDb().ref(`${BASE}/tokenIndex`).get()).val() ?? {}) as any[];
      return idx.length === 1 && idx[0].ownerId === cidA;
    });

    // Log out and log in as Bob on the same phone without clearing the registration first.
    const phoneAsBob = track(await passwordClient("bob@example.com"));
    const cidB = phoneAsBob.uid;
    await registerDevice(phoneAsBob, { type: "customers", id: cidB }, "phone-device-1", "tok-v2");
    await eventually(async () => (await adminDb().ref(`${BASE}/devices/customers/${cidA}/phone-device-1`).get()).val() === null);
    const idx = Object.values((await adminDb().ref(`${BASE}/tokenIndex`).get()).val() ?? {}) as any[];
    expect(idx).toEqual([{ ownerType: "customers", ownerId: cidB, deviceId: "phone-device-1" }]);
  });

  it("clearing a registration removes its index entry", async () => {
    const customer = track(await anonymousClient());
    await registerDevice(customer, { type: "customers", id: customer.uid }, "device-clear-1", "tok-clear");
    await eventually(async () => (await adminDb().ref(`${BASE}/tokenIndex`).get()).exists());
    await set(ref(customer.db, `${BASE}/devices/customers/${customer.uid}/device-clear-1`), null);
    await eventually(async () => !(await adminDb().ref(`${BASE}/tokenIndex`).get()).exists());
  });

  it("revoking an agent removes their device registrations", async () => {
    const { owner, agent } = await setupTeam();
    await registerDevice(agent, { type: "agents", id: agent.uid }, "agent-browser-1", "tok-agent", "web");
    await owner.call("clayverSetAgentRole", { uid: agent.uid, role: "none" });
    expect((await adminDb().ref(`${BASE}/devices/agents/${agent.uid}`).get()).val()).toBeNull();
  });
});

describe("agent mode in the app", () => {
  const conversations = (c: Client) => read(c, `${BASE}/conversations`);

  it("an app user granted a role answers customers and is still a customer", async () => {
    const { owner } = await setupTeam();
    const lead = track(await passwordClient("lead@example.com"));
    await expect(conversations(lead)).rejects.toThrow(/permission/i);

    await owner.call("clayverSetAgentRole", { email: "lead@example.com", role: "agent", displayName: "Lead" });
    expect((await lead.auth.currentUser!.getIdTokenResult(true)).claims.clayver_roles).toEqual({ default: "agent" });
    expect((await adminDb().ref(`${BASE}/agents/${lead.uid}`).get()).val()).toMatchObject({
      role: "agent",
      active: true,
      email: "lead@example.com",
      displayName: "Lead",
    });

    // The app user answers a customer from the SDK.
    const customer = track(await anonymousClient());
    const conv = await startConversation(customer, customer.uid, "help from the app?");
    await eventually(async () => (await conversations(lead))?.[conv]);
    await sendAgentMessage(lead, conv, "answered from the mobile SDK");
    await eventually(async () => (await read(customer, `${BASE}/inbox/${customer.uid}/unreadTotal`)) === 1);

    // ...and can still ask for help as a customer, under the same uid.
    const own = await startConversation(lead, lead.uid, "my own question");
    expect(await read(lead, `${BASE}/conversations/${own}/customerId`)).toBe(lead.uid);
  });

  it("a phone can hold a customer and an agent registration for the same token", async () => {
    const { owner } = await setupTeam();
    const phone = track(await passwordClient("oncall@example.com"));
    await owner.call("clayverSetAgentRole", { email: "oncall@example.com", role: "agent" });
    await phone.auth.currentUser!.getIdToken(true);
    const cid = phone.uid;
    await registerDevice(phone, { type: "customers", id: cid }, "phone-device-1", "tok-shared");
    await registerDevice(phone, { type: "agents", id: phone.uid }, "phone-device-1", "tok-shared");
    await new Promise((r) => setTimeout(r, 800));
    expect(await read(phone, `${BASE}/devices/customers/${cid}/phone-device-1/pushToken`)).toBe("tok-shared");
    expect(await read(phone, `${BASE}/devices/agents/${phone.uid}/phone-device-1/pushToken`)).toBe("tok-shared");

    const customer = track(await anonymousClient());
    await startConversation(customer, customer.uid, "is anyone there?");
    const push = await eventually(async () => (await pushes()).find((p) => p.token === "tok-shared"));
    expect(push.data.audience).toBe("agent");
  });

  it("only admins grant roles, by exactly one of email or uid", async () => {
    const { owner, agent } = await setupTeam();
    await expectCode(agent.call("clayverSetAgentRole", { email: "x@example.com", role: "agent" }), "permission-denied");
    await expectCode(owner.call("clayverSetAgentRole", { uid: agent.uid, email: "x@example.com", role: "agent" }), "invalid-argument");
    // App user ids are no longer accepted: agents are Firebase accounts.
    await expectCode(owner.call("clayverSetAgentRole", { userId: "x", role: "agent" }), "invalid-argument");
  });

  it("customer pushes carry audience customer", async () => {
    const { agent } = await setupTeam();
    const customer = track(await anonymousClient());
    await registerDevice(customer, { type: "customers", id: customer.uid }, "cust-device-1", "tok-cust-aud");
    const conv = await startConversation(customer, customer.uid);
    await sendAgentMessage(agent, conv, "hello");
    const push = await eventually(async () => (await pushes()).find((p) => p.token === "tok-cust-aud"));
    expect(push.data.audience).toBe("customer");
  });
});
