import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  formatBytes,
  isValidEmail,
  normalizeMessageText,
  normalizeSenderName,
  resolveAttachmentContentType,
  sanitizeFileName,
  validateAttachment,
} from "../src/validation.js";
import { ClayverError } from "../src/errors.js";

describe("attachment validation", () => {
  it("accepts allowlisted types", () => {
    expect(validateAttachment({ name: "a.png", size: 10, type: "image/png" })).toEqual({
      fileName: "a.png",
      contentType: "image/png",
      size: 10,
    });
    expect(validateAttachment({ name: "photo.jpg", size: MAX_ATTACHMENT_BYTES, type: "image/jpeg" }).contentType).toBe(
      "image/jpeg",
    );
    expect(() => validateAttachment({ name: "doc.pdf", size: 10, type: "application/pdf" })).toThrow(ClayverError);
  });

  it("rejects files over 300 KiB", () => {
    try {
      validateAttachment({ name: "big.jpg", size: MAX_ATTACHMENT_BYTES + 1, type: "image/jpeg" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ClayverError);
      expect((e as ClayverError).code).toBe("file-too-large");
    }
  });

  it("rejects empty files and disallowed types", () => {
    expect(() => validateAttachment({ name: "a.txt", size: 0, type: "text/plain" })).toThrow(/empty/);
    try {
      validateAttachment({ name: "a.exe", size: 5, type: "application/x-msdownload" });
      expect.unreachable();
    } catch (e) {
      expect((e as ClayverError).code).toBe("unsupported-file-type");
    }
    expect(() => validateAttachment({ name: "a.svg", size: 5, type: "image/svg+xml" })).toThrow(ClayverError);
  });

  it("normalises aliases and guesses from extension when the type is missing", () => {
    expect(resolveAttachmentContentType("x.jpg", "image/jpg")).toBe("image/jpeg");
    expect(resolveAttachmentContentType("x.HEIC", "")).toBe("image/heic");
    expect(resolveAttachmentContentType("photo.png", "application/octet-stream")).toBe("image/png");
    expect(resolveAttachmentContentType("x.bin", "")).toBeNull();
    expect(resolveAttachmentContentType("x.jpg", "image/jpeg; charset=binary")).toBe("image/jpeg");
    expect(resolveAttachmentContentType("notes.txt", "text/plain")).toBeNull();
  });

  it("sanitises file names to one storage segment of at most 200 chars", () => {
    expect(sanitizeFileName("a/b\\c#d[e]?.png")).toBe("a_b_c_d_e__.png");
    expect(sanitizeFileName("...hidden")).toBe("hidden");
    expect(sanitizeFileName("   ")).toBe("file");
    const long = "x".repeat(300) + ".pdf";
    const clean = sanitizeFileName(long);
    expect(clean.length).toBe(200);
    expect(clean.endsWith(".pdf")).toBe(true);
  });
});

describe("text validation", () => {
  it("trims and returns undefined for empty", () => {
    expect(normalizeMessageText("  hi ")).toBe("hi");
    expect(normalizeMessageText("   ")).toBeUndefined();
    expect(normalizeMessageText(undefined)).toBeUndefined();
  });
  it("rejects > 4000 chars", () => {
    expect(() => normalizeMessageText("a".repeat(4001))).toThrow(ClayverError);
    expect(normalizeMessageText("a".repeat(4000))).toHaveLength(4000);
  });
  it("caps sender names at 80", () => {
    expect(normalizeSenderName("n".repeat(100))).toHaveLength(80);
    expect(normalizeSenderName("  ")).toBe("Support");
  });
});

describe("misc", () => {
  it("validates emails", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
  });
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });
});
