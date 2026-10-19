import { describe, expect, it } from "vitest";
import { statusOrder } from "../src/paths";
import { notificationBody } from "../src/push";
import { countUnread, dominates } from "../src/unread";
import { tokenHash } from "../src/push";
import { bumpWindow, isActiveBlock } from "../src/moderation";

describe("unread counting", () => {
  const m = (senderType: "customer" | "agent" | "system", createdAt: number) => ({ senderId: "x", senderType, createdAt });
  it("counts the other side's messages after each read marker; system messages never count", () => {
    const msgs = [m("customer", 10), m("agent", 20), m("system", 25), m("customer", 30), m("agent", 40)];
    expect(countUnread(msgs, 0, 0)).toEqual({ customer: 2, agent: 2, lastMessageAt: 40 });
    expect(countUnread(msgs, 20, 10)).toEqual({ customer: 1, agent: 1, lastMessageAt: 40 });
    expect(countUnread(msgs, 40, 40)).toEqual({ customer: 0, agent: 0, lastMessageAt: 40 });
  });

  it("only accepts inputs at least as new as the stored ones", () => {
    const a = { customerReadAt: 5, agentReadAt: 5, lastMessageAt: 5 };
    expect(dominates(a, undefined)).toBe(true);
    expect(dominates(a, a)).toBe(true);
    expect(dominates(a, { ...a, lastMessageAt: 6 })).toBe(false);
    expect(dominates({ ...a, customerReadAt: 9 }, a)).toBe(true);
  });
});

describe("helpers", () => {
  it("builds sortable status keys", () => {
    expect(statusOrder("open", 1700000000000)).toBe("open_001700000000000");
    expect(statusOrder("closed", 5) < statusOrder("closed", 50)).toBe(true);
  });

  it("summarises messages for notifications", () => {
    expect(notificationBody({ senderId: "a", senderType: "agent", createdAt: 1, text: "hi" })).toBe("hi");
    expect(notificationBody({ senderId: "a", senderType: "agent", createdAt: 1, text: "x".repeat(300) })).toHaveLength(180);
    const att = { storagePath: "p", fileName: "f.pdf", contentType: "application/pdf", size: 1 };
    expect(notificationBody({ senderId: "a", senderType: "agent", createdAt: 1, attachment: att })).toBe("📎 f.pdf");
  });
});

describe("token index keys", () => {
  it("separate audiences so one phone can be a customer and an agent device", () => {
    expect(tokenHash("customers", "t")).not.toBe(tokenHash("agents", "t"));
    expect(tokenHash("agents", "t")).toBe(tokenHash("agents", "t"));
  });
});

describe("rate-limit window", () => {
  it("counts inside the window and restarts after it", () => {
    let w = bumpWindow(null, 1000, 60_000);
    expect(w).toEqual({ start: 1000, count: 1 });
    w = bumpWindow(w, 30_000, 60_000);
    expect(w).toEqual({ start: 1000, count: 2 });
    expect(bumpWindow(w, 61_000, 60_000)).toEqual({ start: 61_000, count: 1 });
  });

  it("a concurrent invocation with a slightly earlier clock still counts", () => {
    expect(bumpWindow({ start: 1000, count: 3 }, 990, 60_000)).toEqual({ start: 1000, count: 4 });
  });
});

describe("moderation blocks", () => {
  it("is active until `until`, or forever without it", () => {
    expect(isActiveBlock({ blocked: true, reason: "spam", by: "a", at: 1 }, 5)).toBe(true);
    expect(isActiveBlock({ blocked: true, reason: "rate_limit", until: 10, by: "system", at: 1 }, 9)).toBe(true);
    expect(isActiveBlock({ blocked: true, reason: "rate_limit", until: 10, by: "system", at: 1 }, 10)).toBe(false);
    expect(isActiveBlock(null, 5)).toBe(false);
  });
});
