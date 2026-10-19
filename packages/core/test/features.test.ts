import { describe, expect, it } from "vitest";
import {
  TAG_PALETTE,
  defaultTagColor,
  filterTags,
  findTagByName,
  isValidTagId,
  normalizeTagName,
  snapshotToTagIds,
  snapshotToTags,
  tagIdForName,
  tagSlug,
  tagsForIds,
} from "../src/tags.js";
import { buildTimeline, canDeleteNote, snapshotToNotes } from "../src/notes.js";
import {
  canDeleteSavedReply,
  filterSavedReplies,
  normalizeSavedReply,
  savedReplyShortcutQuery,
  snapshotToSavedReplies,
} from "../src/savedReplies.js";
import { activeBlock, buildBlockRecord, isBlockActive } from "../src/moderation.js";
import { DEFAULT_RATE_LIMITS, effectiveRateLimits, validateRateLimits } from "../src/workspaceSettings.js";
import { customerExportFileName } from "../src/customers.js";
import { createPaths } from "../src/paths.js";
import { ClayverError } from "../src/errors.js";
import type { Message, Note } from "../src/types.js";

describe("tag ids and colors", () => {
  it("slugs names as the schema describes", () => {
    expect(tagSlug("To do")).toBe("to-do");
    expect(tagSlug("  Feature request! ")).toBe("feature-request");
    expect(tagSlug("Crème brûlée")).toBe("creme-brulee");
    expect(tagSlug("Ärger / Öl")).toBe("arger-ol");
    expect(tagSlug("--Waiting   on customer--")).toBe("waiting-on-customer");
    expect(tagSlug("x".repeat(50))).toBe("x".repeat(40));
    expect(tagSlug("Straße")).toBe("stra-e");
    expect(tagSlug("Søren")).toBe("s-ren");
    // Cut at 40 lands right after a separator: the trailing "-" is trimmed again.
    expect(tagSlug(`${"a".repeat(39)} bcd`)).toBe("a".repeat(39));
    expect(tagSlug("🔥🔥")).toBeNull();
    expect(tagSlug("")).toBeNull();
  });

  it("falls back to tag- plus 8 random characters", () => {
    const id = tagIdForName("🔥");
    expect(id).toMatch(/^tag-[a-z0-9]{8}$/);
    expect(isValidTagId(id)).toBe(true);
    expect(tagIdForName("🔥", () => 0)).toBe("tag-aaaaaaaa");
    expect(tagIdForName("Bug")).toBe("bug");
  });

  it("picks the default color by the sum of UTF-16 code units", () => {
    // "a" = 97 -> 7
    expect(defaultTagColor("a")).toBe(TAG_PALETTE[7]);
    // "todo" = 116+111+100+111 = 438 -> 8
    expect(defaultTagColor("todo")).toBe(TAG_PALETTE[8]);
    expect(TAG_PALETTE).toHaveLength(10);
  });

  it("normalizes names", () => {
    expect(normalizeTagName("  VIP   customer ")).toBe("VIP customer");
    expect(() => normalizeTagName("   ")).toThrow(ClayverError);
    expect(() => normalizeTagName("x".repeat(41))).toThrow(/1-40/);
  });
});

describe("tag snapshots and search", () => {
  const tags = snapshotToTags({
    urgent: { name: "Urgent", color: "#DC2626" },
    bug: { name: "bug", color: "not-a-color" },
    billing: { name: "Billing", color: "#16A34A" },
    broken: { name: "" } as never,
  });

  it("sorts by name case-insensitively and repairs bad colors", () => {
    expect(tags.map((t) => t.id)).toEqual(["billing", "bug", "urgent"]);
    expect(tags[1]!.color).toBe(defaultTagColor("bug"));
    expect(snapshotToTags(null)).toEqual([]);
  });

  it("reads conversation tag ids", () => {
    expect(snapshotToTagIds({ urgent: true, bug: true, x: false })).toEqual(["bug", "urgent"]);
    expect(snapshotToTagIds(null)).toEqual([]);
    expect(tagsForIds(tags, ["urgent", "missing"]).map((t) => t.id)).toEqual(["urgent"]);
  });

  it("filters with prefix matches first and finds exact names", () => {
    expect(filterTags(tags, "b").map((t) => t.id)).toEqual(["billing", "bug"]);
    expect(filterTags(tags, "gent").map((t) => t.id)).toEqual(["urgent"]);
    expect(filterTags(tags, "").length).toBe(3);
    expect(findTagByName(tags, " BUG ")?.id).toBe("bug");
    expect(findTagByName(tags, "Bu")).toBeUndefined();
  });
});

describe("internal notes", () => {
  const msg = (id: string, createdAt: number): Message => ({ id, senderId: "c", senderType: "customer", text: id, createdAt });
  const note = (id: string, createdAt: number, authorUid = "a1"): Note => ({ id, authorUid, text: id, createdAt });

  it("sorts notes chronologically", () => {
    expect(snapshotToNotes({ n2: note("n2", 20), n1: note("n1", 10) }).map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  it("interleaves notes with messages by createdAt", () => {
    const items = buildTimeline([msg("m1", 10), msg("m2", 30)], [note("n1", 20), note("n0", 5), note("n3", 40)]);
    expect(items.map((i) => (i.kind === "note" ? i.note.id : i.message.id))).toEqual(["n0", "m1", "n1", "m2", "n3"]);
  });

  it("holds back notes older than the loaded messages while older pages exist", () => {
    const items = buildTimeline([msg("m1", 10)], [note("n0", 5), note("n1", 15)], true);
    expect(items.map((i) => (i.kind === "note" ? i.note.id : i.message.id))).toEqual(["m1", "n1"]);
  });

  it("lets the author or an admin delete", () => {
    expect(canDeleteNote({ authorUid: "a1" }, "a1", "agent")).toBe(true);
    expect(canDeleteNote({ authorUid: "a1" }, "a2", "agent")).toBe(false);
    expect(canDeleteNote({ authorUid: "a1" }, "a2", "admin")).toBe(true);
  });
});

describe("saved replies", () => {
  const replies = snapshotToSavedReplies({
    r1: { title: "Refund policy", text: "Refunds take 5 days.", createdBy: "a1", createdAt: 1, updatedAt: 1 },
    r2: { title: "Greeting", text: "Hi! How can we help with your refund?", createdBy: "a2", createdAt: 1, updatedAt: 1 },
    r3: { title: "Shipping times", text: "We ship in 2 days.", createdBy: "a1", createdAt: 1, updatedAt: 1 },
  });

  it("sorts by title and ranks title prefix, title, then text matches", () => {
    expect(replies.map((r) => r.id)).toEqual(["r2", "r1", "r3"]);
    expect(filterSavedReplies(replies, "ref").map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(filterSavedReplies(replies, "times").map((r) => r.id)).toEqual(["r3"]);
    expect(filterSavedReplies(replies, "  ")).toHaveLength(3);
  });

  it("validates input", () => {
    expect(normalizeSavedReply({ title: " Hi ", text: " Hello " })).toEqual({ title: "Hi", text: "Hello" });
    expect(() => normalizeSavedReply({ title: "", text: "x" })).toThrow(/title/);
    expect(() => normalizeSavedReply({ title: "x", text: "y".repeat(4001) })).toThrow(/4000/);
  });

  it("detects the slash shortcut", () => {
    expect(savedReplyShortcutQuery("/")).toBe("");
    expect(savedReplyShortcutQuery("/ref")).toBe("ref");
    expect(savedReplyShortcutQuery("hello /ref")).toBeNull();
    expect(savedReplyShortcutQuery("/ref\nmore")).toBeNull();
  });

  it("lets the creator or an admin delete", () => {
    expect(canDeleteSavedReply({ createdBy: "a1" }, "a1", "agent")).toBe(true);
    expect(canDeleteSavedReply({ createdBy: "a1" }, "a2", "agent")).toBe(false);
    expect(canDeleteSavedReply({ createdBy: "a1" }, "a2", "admin")).toBe(true);
  });
});

describe("moderation", () => {
  it("knows when a block is active", () => {
    expect(isBlockActive({ blocked: true }, 100)).toBe(true);
    expect(isBlockActive({ blocked: true, until: 200 }, 100)).toBe(true);
    expect(isBlockActive({ blocked: true, until: 100 }, 100)).toBe(false);
    expect(isBlockActive(null, 100)).toBe(false);
    expect(activeBlock({ blocked: true, reason: "rate_limit", by: "system", at: 1, until: 50 }, 100)).toBeNull();
  });

  it("builds block records", () => {
    expect(buildBlockRecord("u1", { reason: "spam", durationMs: 3_600_000 }, 1000)).toEqual({
      blocked: true,
      reason: "spam",
      by: "u1",
      until: 3_601_000,
    });
    expect(buildBlockRecord("u1", { reason: "abuse", durationMs: null }, 1000)).toEqual({ blocked: true, reason: "abuse", by: "u1" });
    expect(() => buildBlockRecord("u1", { reason: "rate_limit" as never }, 0)).toThrow(/reason/);
    expect(() => buildBlockRecord("u1", { reason: "spam", durationMs: -5 }, 0)).toThrow(/positive/);
  });
});

describe("rate limits", () => {
  it("falls back to the defaults field by field", () => {
    expect(effectiveRateLimits(null)).toEqual(DEFAULT_RATE_LIMITS);
    expect(effectiveRateLimits({ rateLimits: { messagesPerMinute: 5 } })).toEqual({ messagesPerMinute: 5, conversationsPerHour: 10 });
    expect(effectiveRateLimits({ rateLimits: { messagesPerMinute: 0, conversationsPerHour: 2000 } })).toEqual(DEFAULT_RATE_LIMITS);
  });
  it("validates", () => {
    expect(validateRateLimits({ messagesPerMinute: 1, conversationsPerHour: 1000 })).toEqual({ messagesPerMinute: 1, conversationsPerHour: 1000 });
    expect(() => validateRateLimits({ messagesPerMinute: 0, conversationsPerHour: 5 })).toThrow(/Messages per minute/);
    expect(() => validateRateLimits({ messagesPerMinute: 5, conversationsPerHour: 2.5 })).toThrow(/Conversations per hour/);
  });
});

describe("customers", () => {
  it("names export files", () => {
    expect(customerExportFileName("v_ab/c", new Date("2026-01-02T03:04:05Z"))).toBe("clayver-customer-v_ab_c-2026-01-02.json");
  });
});

describe("feature paths", () => {
  const p = createPaths("default");
  it("builds tag, note, saved reply, moderation and config paths", () => {
    expect(p.tags()).toBe("clayver/projects/default/tags");
    expect(p.tag("bug")).toBe("clayver/projects/default/tags/bug");
    expect(p.conversationTags("-c1")).toBe("clayver/projects/default/conversationTags/-c1");
    expect(p.conversationTag("-c1", "bug")).toBe("clayver/projects/default/conversationTags/-c1/bug");
    expect(p.tagIndex("bug")).toBe("clayver/projects/default/tagIndex/bug");
    expect(p.notes("-c1")).toBe("clayver/projects/default/notes/-c1");
    expect(p.note("-c1", "-n1")).toBe("clayver/projects/default/notes/-c1/-n1");
    expect(p.savedReplies()).toBe("clayver/projects/default/savedReplies");
    expect(p.savedReply("-r1")).toBe("clayver/projects/default/savedReplies/-r1");
    expect(p.moderation("v_a")).toBe("clayver/projects/default/moderation/v_a");
    expect(p.rateLimits()).toBe("clayver/projects/default/config/private/rateLimits");
    expect(() => p.tag("a/b")).toThrow(ClayverError);
  });
});
