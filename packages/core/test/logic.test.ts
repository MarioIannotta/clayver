import { describe, expect, it } from "vitest";
import { isSeenByCustomer, needsAgentRead, snapshotToConversations } from "../src/conversations.js";
import { sortMessages } from "../src/messages.js";
import { customerEmail, customerLabel, customerName, customerUserId, otherProperties } from "../src/customers.js";
import { UserProperty } from "../src/paths.js";
import { isValidPropertyKey } from "../src/validation.js";
import { snapshotToAgents } from "../src/team.js";
import { effectiveRole, agentDisplayName } from "../src/auth.js";
import {
  dashboardPathForPush,
  generateDeviceId,
  getOrCreateDeviceId,
  isClayverPushData,
} from "../src/push.js";
import { DEVICE_ID_PATTERN } from "../src/paths.js";

describe("conversations", () => {
  it("converts and sorts snapshots", () => {
    const list = snapshotToConversations({
      a: { customerId: "x", status: "open", createdAt: 1, updatedAt: 5 },
      b: { customerId: "y", status: "open", createdAt: 1, updatedAt: 9 },
    });
    expect(list.map((c) => c.id)).toEqual(["b", "a"]);
    expect(snapshotToConversations(null)).toEqual([]);
  });

  it("computes seen receipts", () => {
    expect(isSeenByCustomer({ customer: { lastReadAt: 100 } }, 100)).toBe(true);
    expect(isSeenByCustomer({ customer: { lastReadAt: 99 } }, 100)).toBe(false);
    expect(isSeenByCustomer({}, 1)).toBe(false);
  });

  it("decides when to write the agent read marker", () => {
    expect(needsAgentRead({ unread: { agent: 2, customer: 0 } }, {})).toBe(true);
    expect(
      needsAgentRead(
        { unread: { agent: 0, customer: 0 }, lastMessage: { text: "", senderType: "customer", createdAt: 50, hasAttachment: false } },
        { agent: { lastReadAt: 40, uid: "u" } },
      ),
    ).toBe(true);
    expect(
      needsAgentRead(
        { unread: { agent: 0, customer: 0 }, lastMessage: { text: "", senderType: "agent", createdAt: 50, hasAttachment: false } },
        { agent: { lastReadAt: 40, uid: "u" } },
      ),
    ).toBe(false);
    expect(needsAgentRead(null, {})).toBe(false);
  });
});

describe("messages", () => {
  it("sorts by push key", () => {
    const m = (id: string) => ({ id, senderId: "s", senderType: "customer" as const, createdAt: 0 });
    expect(sortMessages([m("-Nb"), m("-Na"), m("-Nc")]).map((x) => x.id)).toEqual(["-Na", "-Nb", "-Nc"]);
  });
});

describe("customers", () => {
  it("labels customers", () => {
    expect(customerLabel({ properties: { [UserProperty.name]: " Ada " } }, "v_123")).toBe("Ada");
    expect(customerLabel({ properties: { [UserProperty.email]: "a@b.c" } }, "v_123")).toBe("a@b.c");
    expect(
      customerLabel({ account: { anonymous: false, email: "x@y.z", emailVerified: true, displayName: null } }, "v_123"),
    ).toBe("x@y.z");
    expect(customerLabel({ properties: { name: "Plain key" } }, "v_abcdef123")).toBe("Visitor abcdef");
    expect(customerLabel(null, "v_abcdef123")).toBe("Visitor abcdef");
  });
  it("reads the user properties", () => {
    const customer = { properties: { [UserProperty.uid]: "u-42", [UserProperty.email]: "a@b.c" } };
    expect(customerUserId(customer)).toBe("u-42");
    expect(customerEmail(customer)).toBe("a@b.c");
    expect(customerName(customer)).toBeUndefined();
  });
  it("lists non-special properties", () => {
    expect(otherProperties({ properties: { [UserProperty.name]: "A", name: "B", plan: "pro", age: 3 } })).toEqual([
      ["age", 3],
      ["name", "B"],
      ["plan", "pro"],
    ]);
  });
  it("accepts user property keys and rejects other underscore keys", () => {
    expect(isValidPropertyKey(UserProperty.uid)).toBe(true);
    expect(isValidPropertyKey("plan_2")).toBe(true);
    expect(isValidPropertyKey("_custom")).toBe(false);
    expect(isValidPropertyKey("$name")).toBe(false);
  });
});

describe("team", () => {
  it("sorts active admins first", () => {
    const agents = snapshotToAgents({
      u1: { role: "agent", active: true, email: "b@x" },
      u2: { role: "admin", active: true, email: "z@x" },
      u3: { role: "admin", active: false, email: "a@x" },
    });
    expect(agents.map((a) => a.uid)).toEqual(["u2", "u1", "u3"]);
  });
  it("derives effective role", () => {
    expect(effectiveRole({ role: "admin", active: true })).toBe("admin");
    expect(effectiveRole({ role: "admin", active: false })).toBeNull();
    expect(effectiveRole(null)).toBeNull();
  });
  it("picks a display name", () => {
    expect(agentDisplayName({ displayName: null, email: "jo@x.com" }, null)).toBe("jo");
    expect(agentDisplayName({ displayName: "Jo", email: null }, { role: "agent", active: true, displayName: "Joanna" })).toBe("Joanna");
  });
});

describe("push", () => {
  it("generates valid device ids", () => {
    for (let i = 0; i < 50; i++) expect(generateDeviceId()).toMatch(DEVICE_ID_PATTERN);
    expect(generateDeviceId(2)).toHaveLength(8);
  });
  it("persists the device id", () => {
    const store = new Map<string, string>();
    const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const a = getOrCreateDeviceId(kv);
    expect(getOrCreateDeviceId(kv)).toBe(a);
    expect(getOrCreateDeviceId(null)).toMatch(DEVICE_ID_PATTERN);
  });
  it("recognises clayver push data and deep links", () => {
    const data = { clayver: "1", type: "message", projectId: "default", conversationId: "-Nx", messageId: "-Ny", link: "clayver://conversation/-Nx" };
    expect(isClayverPushData(data)).toBe(true);
    expect(isClayverPushData({ foo: 1 })).toBe(false);
    expect(dashboardPathForPush(data)).toBe("/conversations/-Nx");
    expect(dashboardPathForPush(data, "/support")).toBe("/support/conversations/-Nx");
    expect(dashboardPathForPush({})).toBeNull();
  });
});
