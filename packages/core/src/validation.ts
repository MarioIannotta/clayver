/**
 * Client-side validation mirroring the security rules, so the UI can reject a
 * bad input with a helpful message before the server rejects it opaquely.
 */
import { ClayverError } from "./errors.js";
import { PROPERTY_KEY_PATTERN, USER_PROPERTY_KEYS } from "./paths.js";

/** Photos are compressed before upload to fit this (see the security rules). */
export const MAX_ATTACHMENT_BYTES = 300 * 1024;
export const MAX_FILE_NAME_LENGTH = 200;
export const MAX_TEXT_LENGTH = 4000;
export const MAX_SENDER_NAME_LENGTH = 80;
export const MAX_CLIENT_MESSAGE_ID_LENGTH = 64;

export const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
] as const;
export type AllowedAttachmentType = (typeof ALLOWED_ATTACHMENT_TYPES)[number];

/** File extensions accepted by the composer's file picker. */
export const ATTACHMENT_ACCEPT =
  ".jpg,.jpeg,.png,.gif,.webp,.heic," + ALLOWED_ATTACHMENT_TYPES.join(",");

const EXTENSION_TYPES: Record<string, AllowedAttachmentType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
};

/** Browser-reported aliases that mean an allowed type. */
const TYPE_ALIASES: Record<string, AllowedAttachmentType> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
};

export function isAllowedContentType(type: string): type is AllowedAttachmentType {
  return (ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(type);
}

export function isImageContentType(type: string | undefined): boolean {
  return !!type && type.startsWith("image/");
}

/**
 * Resolves the content type to upload with: the browser's type when it is in
 * the allowlist (after alias normalisation), else a guess from the extension.
 * Returns `null` when the file cannot be sent.
 */
export function resolveAttachmentContentType(
  fileName: string,
  reportedType: string | undefined,
): AllowedAttachmentType | null {
  const type = (reportedType ?? "").toLowerCase().split(";")[0]!.trim();
  if (isAllowedContentType(type)) return type;
  const alias = TYPE_ALIASES[type];
  if (alias) return alias;
  if (type === "" || type === "application/octet-stream") {
    const ext = fileName.toLowerCase().split(".").pop() ?? "";
    return EXTENSION_TYPES[ext] ?? null;
  }
  return null;
}

/**
 * Makes a file name safe as a single Storage path segment and caps it at 200
 * characters while keeping the extension.
 */
export function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  let clean = name.replace(/[\u0000-\u001f\u007f/\\#[\]*?]/g, "_").trim();
  clean = clean.replace(/^\.+/, "");
  if (!clean) clean = "file";
  if (clean.length > MAX_FILE_NAME_LENGTH) {
    const dot = clean.lastIndexOf(".");
    const ext = dot > 0 && clean.length - dot <= 16 ? clean.slice(dot) : "";
    clean = clean.slice(0, MAX_FILE_NAME_LENGTH - ext.length) + ext;
  }
  return clean;
}

export interface AttachmentCandidate {
  name: string;
  size: number;
  type?: string;
}

export interface ValidatedAttachment {
  fileName: string;
  contentType: AllowedAttachmentType;
  size: number;
}

/** Throws a ClayverError describing why `file` cannot be attached. */
export function validateAttachment(file: AttachmentCandidate): ValidatedAttachment {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new ClayverError("invalid-argument", "The file is empty.");
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new ClayverError(
      "file-too-large",
      `"${file.name}" is ${formatBytes(file.size)}; attachments are limited to ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
    );
  }
  const contentType = resolveAttachmentContentType(file.name, file.type);
  if (!contentType) {
    throw new ClayverError(
      "unsupported-file-type",
      `"${file.name}" is not a supported file type. Only photos can be attached (JPEG, PNG, GIF, WebP, HEIC).`,
    );
  }
  return { fileName: sanitizeFileName(file.name), contentType, size: file.size };
}

/** Trims the text and checks its length. Returns `undefined` for empty text. */
export function normalizeMessageText(text: string | undefined | null): string | undefined {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new ClayverError(
      "invalid-argument",
      `Messages are limited to ${MAX_TEXT_LENGTH} characters (this one has ${trimmed.length}).`,
    );
  }
  return trimmed;
}

/** Caps a display name to what the rules accept for `senderName`. */
export function normalizeSenderName(name: string | undefined | null, fallback = "Support"): string {
  const trimmed = (name ?? "").trim() || fallback;
  return trimmed.slice(0, MAX_SENDER_NAME_LENGTH);
}

/** A custom property key, or one of `UserProperty`. */
export function isValidPropertyKey(key: string): boolean {
  return USER_PROPERTY_KEYS.includes(key) || PROPERTY_KEY_PATTERN.test(key);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
