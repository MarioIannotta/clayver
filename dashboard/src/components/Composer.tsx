import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ATTACHMENT_ACCEPT,
  MAX_TEXT_LENGTH,
  compressImage,
  errorMessage,
  filterSavedReplies,
  formatBytes,
  readImageSize,
  savedReplyShortcutQuery,
  sendAgentReply,
  validateAttachment,
  type SavedReply,
} from "@clayver/core";
import { useClient } from "../clayver";
import { useAgent } from "../auth";
import { useSavedReplies } from "../lib/hooks";
import { SavedReplyPicker } from "./SavedReplyPicker";
import { ErrorBanner } from "./ui";

export function Composer({
  conversationId,
  customerId,
  closed,
}: {
  conversationId: string;
  customerId: string;
  closed: boolean;
}) {
  const client = useClient();
  const { displayName } = useAgent();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textId = useId();
  const hintId = useId();
  const pickerListId = useId();

  // Saved replies: "/" at the start of an empty composer, or the button.
  const savedReplies = useSavedReplies();
  const [pickerFromButton, setPickerFromButton] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [activeReply, setActiveReply] = useState(0);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const slashQuery = savedReplyShortcutQuery(text);
  const slashOpen = !pickerFromButton && slashQuery !== null && !slashDismissed;
  const pickerOpen = pickerFromButton || slashOpen;
  const pickerItems = pickerOpen
    ? filterSavedReplies(savedReplies.data, pickerFromButton ? pickerSearch : (slashQuery ?? ""))
    : [];

  useEffect(() => setActiveReply(0), [pickerSearch, slashQuery, pickerFromButton]);

  const canSend = !sending && (text.trim().length > 0 || file !== null);

  const pickFile = async (picked: File | null) => {
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
    if (!picked) return setFile(null);
    try {
      const f = await compressImage(picked);
      validateAttachment(f);
      setFile(f);
    } catch (err) {
      setError(errorMessage(err));
      setFile(null);
    }
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      setProgress(file ? 0 : null);
      const imageSize = file ? await readImageSize(file) : null;
      await sendAgentReply(client, {
        conversationId,
        customerId,
        text,
        senderName: displayName,
        file,
        imageSize,
        clientMessageId: crypto.randomUUID?.(),
        onUploadProgress: setProgress,
      });
      setFile(null);
      setText("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
      setProgress(null);
      // The textarea is disabled while sending; focus once it is enabled again.
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    }
  };

  const closePicker = () => {
    if (pickerFromButton) {
      setPickerFromButton(false);
      setPickerSearch("");
    } else {
      setSlashDismissed(true);
    }
    textareaRef.current?.focus();
  };

  const insertReply = (reply: SavedReply) => {
    let next: string;
    let caret: number;
    if (pickerFromButton) {
      const { start, end } = selection.current ?? { start: text.length, end: text.length };
      next = text.slice(0, start) + reply.text + text.slice(end);
      caret = start + reply.text.length;
    } else {
      // "/query" is replaced by the reply.
      next = reply.text;
      caret = next.length;
    }
    next = next.slice(0, MAX_TEXT_LENGTH);
    setText(next);
    setPickerFromButton(false);
    setPickerSearch("");
    setSlashDismissed(false);
    window.setTimeout(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(Math.min(caret, next.length), Math.min(caret, next.length));
    }, 0);
  };

  /** Arrow keys, Enter and Escape drive the picker; returns true when handled. */
  const pickerKey = (e: KeyboardEvent<HTMLElement>): boolean => {
    if (!pickerOpen) return false;
    if (e.key === "ArrowDown") {
      setActiveReply((i) => Math.min(pickerItems.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      setActiveReply((i) => Math.max(0, i - 1));
    } else if ((e.key === "Enter" || e.key === "Tab") && pickerItems[activeReply]) {
      insertReply(pickerItems[activeReply]);
    } else if (e.key === "Escape") {
      closePicker();
    } else {
      return false;
    }
    e.preventDefault();
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && pickerKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const openPickerFromButton = () => {
    if (pickerFromButton) return closePicker();
    const el = textareaRef.current;
    selection.current = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
    setPickerFromButton(true);
    setPickerSearch("");
  };

  return (
    <form className="composer" onSubmit={send} aria-label="Reply">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      {closed && (
        <p className="composer__hint">This conversation is closed. You can still reply, or reopen it from the header.</p>
      )}
      {file && (
        <div className="composer__file">
          <span>
            {file.name} <span className="muted">({formatBytes(file.size)})</span>
          </span>
          {progress !== null ? (
            <progress max={1} value={progress} aria-label="Upload progress" />
          ) : (
            <button type="button" className="btn btn--small btn--ghost" onClick={() => setFile(null)} aria-label={`Remove ${file.name}`}>
              ×
            </button>
          )}
        </div>
      )}
      <div className="composer__row">
        {pickerOpen && (
          <SavedReplyPicker
            replies={pickerItems}
            loading={savedReplies.loading}
            active={activeReply}
            onActiveChange={setActiveReply}
            onPick={insertReply}
            listId={pickerListId}
            {...(pickerFromButton
              ? {
                  search: pickerSearch,
                  onSearchChange: setPickerSearch,
                  onSearchKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void pickerKey(e),
                }
              : {})}
          />
        )}
        <label htmlFor={textId} className="visually-hidden">
          Reply message
        </label>
        <textarea
          id={textId}
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (savedReplyShortcutQuery(e.target.value) === null) setSlashDismissed(false);
          }}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const pasted = e.clipboardData.files[0];
            if (pasted) {
              e.preventDefault();
              void pickFile(pasted);
            }
          }}
          placeholder="Write a reply…"
          rows={3}
          maxLength={MAX_TEXT_LENGTH}
          aria-describedby={hintId}
          aria-controls={slashOpen ? pickerListId : undefined}
          aria-activedescendant={slashOpen && pickerItems[activeReply] ? `${pickerListId}-${activeReply}` : undefined}
          disabled={sending}
        />
        <div className="composer__actions">
          <>
              <input
                ref={fileInput}
                type="file"
                accept={ATTACHMENT_ACCEPT}
                className="visually-hidden"
                id={`${textId}-file`}
                onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
                disabled={sending}
              />
              <label htmlFor={`${textId}-file`} className="btn btn--ghost" title="Attach a photo">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
                </svg>
                <span className="visually-hidden">Attach photo</span>
              </label>
          </>
          <button type="submit" className="btn btn--primary" disabled={!canSend}>
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
      <p id={hintId} className="composer__hint">
        Enter to send, Shift+Enter for a new line. / to see{" "}
        <button
          type="button"
          className="link-button"
          aria-haspopup="listbox"
          aria-expanded={pickerFromButton}
          onClick={openPickerFromButton}
          disabled={sending}
        >
          saved replies
        </button>
      </p>
    </form>
  );
}
