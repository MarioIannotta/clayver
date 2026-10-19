import { describe, expect, it } from "vitest";
import {
  compareConversationsByRecency,
  conversationActivityAt,
  formatStatusOrder,
  parseStatusOrder,
  statusOrderRange,
} from "../src/statusOrder.js";

describe("statusOrder", () => {
  it("formats with a 15-digit zero-padded timestamp", () => {
    expect(formatStatusOrder("open", 1700000000000)).toBe("open_001700000000000");
    expect(formatStatusOrder("closed", 0)).toBe("closed_000000000000000");
  });

  it("round-trips through parse", () => {
    expect(parseStatusOrder(formatStatusOrder("closed", 1712345678901))).toEqual({
      status: "closed",
      updatedAt: 1712345678901,
    });
  });

  it("rejects malformed values", () => {
    expect(parseStatusOrder("open_123")).toBeNull();
    expect(parseStatusOrder("pending_001700000000000")).toBeNull();
    expect(parseStatusOrder(undefined)).toBeNull();
    expect(parseStatusOrder(42)).toBeNull();
    expect(parseStatusOrder("open_00170000000000a")).toBeNull();
  });

  it("orders lexicographically by time within a status", () => {
    const a = formatStatusOrder("open", 999);
    const b = formatStatusOrder("open", 1000);
    expect(a < b).toBe(true);
  });

  it("range bounds include every value of the status and nothing else", () => {
    const { start, end } = statusOrderRange("open");
    const inRange = (v: string) => v >= start && v <= end;
    expect(inRange(formatStatusOrder("open", 0))).toBe(true);
    expect(inRange(formatStatusOrder("open", 999999999999999))).toBe(true);
    expect(inRange(formatStatusOrder("closed", 5))).toBe(false);
    const closed = statusOrderRange("closed");
    expect(formatStatusOrder("open", 5) >= closed.start && formatStatusOrder("open", 5) <= closed.end).toBe(false);
  });

  it("derives activity time and sorts newest first", () => {
    const base = { customerId: "c", status: "open" as const, createdAt: 1 };
    expect(conversationActivityAt({ ...base, updatedAt: 50 })).toBe(50);
    expect(conversationActivityAt({ ...base, statusOrder: formatStatusOrder("open", 40) })).toBe(40);
    expect(conversationActivityAt(base)).toBe(1);
    const list = [
      { id: "a", ...base, updatedAt: 10 },
      { id: "b", ...base, updatedAt: 30 },
      { id: "c", ...base, updatedAt: 20 },
    ].sort(compareConversationsByRecency);
    expect(list.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });
});
