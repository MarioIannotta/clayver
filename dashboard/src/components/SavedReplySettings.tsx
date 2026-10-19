import { useId, useState, type FormEvent } from "react";
import {
  canDeleteSavedReply,
  createSavedReply,
  deleteSavedReply,
  errorMessage,
  MAX_SAVED_REPLY_TITLE_LENGTH,
  MAX_TEXT_LENGTH,
  updateSavedReply,
  type SavedReply,
} from "@clayver/core";
import { useClient } from "../clayver";
import { useAgent } from "../auth";
import { useSavedReplies } from "../lib/hooks";
import { EmptyState, ErrorBanner, Spinner } from "./ui";

export function SavedReplySettings() {
  const replies = useSavedReplies();
  const [adding, setAdding] = useState(false);

  return (
    <section className="card" aria-labelledby="saved-replies-title" id="saved-replies">
      <div className="card__header">
        <h2 id="saved-replies-title">Saved replies</h2>
        {!adding && (
          <button type="button" className="btn btn--small" onClick={() => setAdding(true)}>
            New saved reply
          </button>
        )}
      </div>
      <p className="muted small">
        Shared with the whole team. In the composer, type <kbd>/</kbd> or click <strong>Saved replies</strong> to insert one.
      </p>
      {adding && <SavedReplyForm onDone={() => setAdding(false)} />}
      <ErrorBanner error={replies.error} />
      {replies.loading ? (
        <Spinner label="Loading saved replies" />
      ) : replies.data.length === 0 ? (
        !adding && <EmptyState title="No saved replies yet" />
      ) : (
        <ul className="settings-list">
          {replies.data.map((r) => (
            <SavedReplyRow key={r.id} reply={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SavedReplyForm({ reply, onDone }: { reply?: SavedReply; onDone: () => void }) {
  const client = useClient();
  const [title, setTitle] = useState(reply?.title ?? "");
  const [text, setText] = useState(reply?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const textId = useId();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (reply) await updateSavedReply(client, reply.id, { title, text });
      else await createSavedReply(client, { title, text });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form className="stack saved-reply-form" onSubmit={onSubmit}>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <div className="field">
        <label htmlFor={titleId} className="field__label">
          Title
        </label>
        <input
          id={titleId}
          type="text"
          required
          maxLength={MAX_SAVED_REPLY_TITLE_LENGTH}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
      </div>
      <div className="field">
        <label htmlFor={textId} className="field__label">
          Text
        </label>
        <textarea id={textId} required rows={4} maxLength={MAX_TEXT_LENGTH} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="block-form__actions">
        <button type="submit" className="btn btn--small btn--primary" disabled={busy || !title.trim() || !text.trim()}>
          {busy ? "Saving…" : reply ? "Save" : "Add saved reply"}
        </button>
        <button type="button" className="btn btn--small btn--ghost" onClick={onDone} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function SavedReplyRow({ reply }: { reply: SavedReply }) {
  const client = useClient();
  const { user, role } = useAgent();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <li className="settings-list__row">
        <SavedReplyForm reply={reply} onDone={() => setEditing(false)} />
      </li>
    );
  }

  const onDelete = async () => {
    if (!window.confirm(`Delete the saved reply “${reply.title}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSavedReply(client, reply.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <li className="settings-list__row saved-reply-row">
      <div className="saved-reply-row__body">
        <strong>{reply.title}</strong>
        <p className="saved-reply-row__text">{reply.text}</p>
        {error && <p className="error-text small">{error}</p>}
      </div>
      <span className="tag-row__actions">
        <button type="button" className="btn btn--small btn--ghost" onClick={() => setEditing(true)} aria-label={`Edit ${reply.title}`}>
          Edit
        </button>
        {canDeleteSavedReply(reply, user.uid, role) && (
          <button
            type="button"
            className="btn btn--small btn--ghost btn--danger"
            onClick={() => void onDelete()}
            disabled={busy}
            aria-label={`Delete ${reply.title}`}
          >
            Delete
          </button>
        )}
      </span>
    </li>
  );
}
