/**
 * Message history (live + paginated) and agent replies.
 */
import {
  endBefore,
  get,
  limitToLast,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  orderByKey,
  push,
  query,
  ref,
  serverTimestamp,
  set,
  startAt,
  type DataSnapshot,
} from "firebase/database";
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from "firebase/storage";
import type { ClayverClient } from "./client.js";
import { ClayverError, toClayverError } from "./errors.js";
import type { Attachment, Message, MessageRecord, Unsubscribe } from "./types.js";
import {
  MAX_CLIENT_MESSAGE_ID_LENGTH,
  normalizeMessageText,
  normalizeSenderName,
  validateAttachment,
  MAX_ATTACHMENT_BYTES,
  isImageContentType,
} from "./validation.js";

export const DEFAULT_MESSAGE_PAGE_SIZE = 30;

export interface MessagesState {
  /** Chronological (oldest first). */
  messages: Message[];
  /** True until the newest page has been loaded. */
  loading: boolean;
  /** True while an older page is being fetched. */
  loadingOlder: boolean;
  /** True when older messages may exist. */
  hasMore: boolean;
  error: ClayverError | null;
}

export interface MessagesSubscription {
  /** Fetches the previous page (`orderByKey().endBefore(oldestKey).limitToLast(n)`). */
  loadOlder(): Promise<void>;
  unsubscribe: Unsubscribe;
}

function toMessage(snap: DataSnapshot): Message | null {
  const value = snap.val() as MessageRecord | null;
  if (!value || !snap.key) return null;
  return { id: snap.key, ...value };
}

/** Sorts messages by key; push ids are chronological. */
export function sortMessages(messages: Iterable<Message>): Message[] {
  return [...messages].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Subscribes to a conversation's messages.
 *
 * 1. Fetches the newest page with `orderByKey().limitToLast(pageSize)`.
 * 2. Listens live from the oldest key of that page onwards
 *    (`orderByKey().startAt(oldestKey)`), so new messages never push loaded
 *    ones out of the window.
 * 3. `loadOlder()` fetches the page before the oldest loaded key with
 *    `orderByKey().endBefore(oldestKey).limitToLast(pageSize)`.
 */
export function subscribeMessages(
  client: ClayverClient,
  conversationId: string,
  callback: (state: MessagesState) => void,
  options: { pageSize?: number } = {},
): MessagesSubscription {
  const pageSize = Math.max(1, options.pageSize ?? DEFAULT_MESSAGE_PAGE_SIZE);
  const messagesRef = ref(client.db, client.paths.messages(conversationId));
  const byId = new Map<string, Message>();
  let oldestKey: string | null = null;
  let hasMore = false;
  let loading = true;
  let loadingOlder = false;
  let error: ClayverError | null = null;
  let closed = false;
  const detachers: Unsubscribe[] = [];

  const emit = () => {
    if (closed) return;
    callback({ messages: sortMessages(byId.values()), loading, loadingOlder, hasMore, error });
  };
  const fail = (err: unknown) => {
    error = toClayverError(err);
    loading = false;
    loadingOlder = false;
    emit();
  };

  emit();

  void (async () => {
    try {
      const first = await get(query(messagesRef, orderByKey(), limitToLast(pageSize)));
      if (closed) return;
      first.forEach((child) => {
        const m = toMessage(child);
        if (m) byId.set(m.id, m);
      });
      const keys = [...byId.keys()].sort();
      oldestKey = keys[0] ?? null;
      hasMore = keys.length >= pageSize;
      loading = false;
      emit();

      const live = oldestKey ? query(messagesRef, orderByKey(), startAt(oldestKey)) : query(messagesRef, orderByKey());
      const upsert = (snap: DataSnapshot) => {
        const m = toMessage(snap);
        if (m) {
          byId.set(m.id, m);
          emit();
        }
      };
      detachers.push(onChildAdded(live, upsert, fail));
      detachers.push(onChildChanged(live, upsert, fail));
      detachers.push(
        onChildRemoved(live, (snap) => {
          if (snap.key && byId.delete(snap.key)) emit();
        }),
      );
    } catch (err) {
      fail(err);
    }
  })();

  return {
    async loadOlder() {
      if (closed || loadingOlder || !hasMore || !oldestKey) return;
      loadingOlder = true;
      emit();
      try {
        const snap = await get(
          query(messagesRef, orderByKey(), endBefore(oldestKey), limitToLast(pageSize)),
        );
        let count = 0;
        snap.forEach((child) => {
          const m = toMessage(child);
          if (m) {
            byId.set(m.id, m);
            count++;
            if (!oldestKey || m.id < oldestKey) oldestKey = m.id;
          }
        });
        hasMore = count >= pageSize;
        loadingOlder = false;
        emit();
      } catch (err) {
        fail(err);
      }
    },
    unsubscribe() {
      closed = true;
      detachers.forEach((d) => d());
      detachers.length = 0;
    },
  };
}

export interface FileLike {
  name: string;
  size: number;
  type: string;
}

export interface SendAgentReplyInput {
  conversationId: string;
  /** Owner of the conversation; needed for the attachment storage path. */
  customerId: string;
  text?: string;
  /** Display name stored as `senderName` (≤ 80 chars). */
  senderName: string;
  /** Optional file (a browser `File` or `Blob` with a name). */
  file?: (Blob & FileLike) | null;
  /** Image dimensions to store with an image attachment. */
  imageSize?: { width: number; height: number } | null;
  clientMessageId?: string;
  /** Upload progress in [0, 1]. */
  onUploadProgress?: (fraction: number) => void;
}

/**
 * Sends a reply as the signed-in agent:
 * `{ senderId: auth.uid, senderType: "agent", senderName, text?, attachment?, createdAt: now }`.
 * An attachment is first uploaded to
 * `clayver/projects/{p}/customers/{cid}/conversations/{id}/{attachmentId}/{fileName}`.
 * Returns the new message id.
 */
export async function sendAgentReply(client: ClayverClient, input: SendAgentReplyInput): Promise<string> {
  const uid = client.auth.currentUser?.uid;
  if (!uid) throw new ClayverError("unauthenticated", "You are signed out.");

  const text = normalizeMessageText(input.text);
  if (!text && !input.file) {
    throw new ClayverError("invalid-argument", "Write a message or attach a file.");
  }
  if (input.clientMessageId && input.clientMessageId.length > MAX_CLIENT_MESSAGE_ID_LENGTH) {
    throw new ClayverError("invalid-argument", "clientMessageId is too long.");
  }

  const messagesRef = ref(client.db, client.paths.messages(input.conversationId));
  const messageRef = push(messagesRef);

  try {
    let attachment: Attachment | undefined;
    if (input.file) {
      const valid = validateAttachment(input.file);
      const attachmentId = push(ref(client.db, client.paths.messages(input.conversationId))).key!;
      const storagePath = client.paths.storageAttachment(
        input.customerId,
        input.conversationId,
        attachmentId,
        valid.fileName,
      );
      const task = uploadBytesResumable(storageRef(client.storage, storagePath), input.file, {
        contentType: valid.contentType,
      });
      if (input.onUploadProgress) {
        task.on("state_changed", (s) => {
          if (s.totalBytes > 0) input.onUploadProgress?.(s.bytesTransferred / s.totalBytes);
        });
      }
      await task;
      attachment = {
        storagePath,
        fileName: valid.fileName,
        contentType: valid.contentType,
        size: valid.size,
      };
      if (input.imageSize && isImageContentType(valid.contentType)) {
        attachment.width = Math.round(input.imageSize.width);
        attachment.height = Math.round(input.imageSize.height);
      }
    }

    const record: Record<string, unknown> = {
      senderId: uid,
      senderType: "agent",
      senderName: normalizeSenderName(input.senderName),
      createdAt: serverTimestamp(),
    };
    if (text) record.text = text;
    if (attachment) record.attachment = attachment;
    if (input.clientMessageId) record.clientMessageId = input.clientMessageId;

    await set(messageRef, record);
    return messageRef.key!;
  } catch (err) {
    throw toClayverError(err);
  }
}

const downloadUrlCache = new Map<string, Promise<string>>();

/** Resolves (and caches) a download URL for an attachment's storage path. */
export function getAttachmentUrl(client: ClayverClient, storagePath: string): Promise<string> {
  let p = downloadUrlCache.get(storagePath);
  if (!p) {
    p = getDownloadURL(storageRef(client.storage, storagePath)).catch((err: unknown) => {
      downloadUrlCache.delete(storagePath);
      throw toClayverError(err);
    });
    downloadUrlCache.set(storagePath, p);
  }
  return p;
}

/** Reads an image file's pixel size in the browser; null when unavailable. */
export async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  if (!isImageContentType(file.type) || typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/**
 * Re-encodes a photo as a JPEG of at most `maxBytes` (the attachment limit),
 * shrinking it to `maxSide` pixels and lowering the quality until it fits.
 * Returns the file unchanged when it already fits as a JPEG, or when the
 * browser cannot decode it (validation then reports the problem).
 */
export async function compressImage(
  file: File,
  { maxBytes = MAX_ATTACHMENT_BYTES, maxSide = 1600 }: { maxBytes?: number; maxSide?: number } = {},
): Promise<File> {
  if (file.type === "image/jpeg" && file.size <= maxBytes) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    let scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      // JPEG has no transparency: paint transparent areas white rather than black.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.72, 0.62, 0.52]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob && blob.size <= maxBytes) {
          const name = file.name.replace(/\.[^.]*$/, "") || "photo";
          return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
        }
      }
      scale *= 0.75;
    }
    return file;
  } finally {
    bitmap.close();
  }
}
