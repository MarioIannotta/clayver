import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { addNote, canDeleteNote, deleteNote, errorMessage, MAX_TEXT_LENGTH, type Note } from "@clayver/core";
import { useClient } from "../clayver";
import { useAgent } from "../auth";
import { formatFull, formatShort } from "../lib/format";
import { useNow } from "../lib/hooks";
import { ErrorBanner } from "./ui";

/** Internal notes in the side panel: visible to the team only, never to the customer. */
export function NotesPanel({ conversationId, notes }: { conversationId: string; notes: Note[] }) {
  const client = useClient();
  const { displayName } = useAgent();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const now = useNow();

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addNote(client, { conversationId, text, authorName: displayName });
      setText("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  };

  // Newest first, so the latest note sits right under the form.
  const sorted = [...notes].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <section className="notes-panel" aria-labelledby={`${inputId}-title`}>
      <h3 className="customer-panel__section" id={`${inputId}-title`}>
        Internal notes
      </h3>
      <form className="notes-panel__form" onSubmit={(e) => void save(e)}>
        <label htmlFor={inputId} className="visually-hidden">
          New internal note
        </label>
        <textarea
          id={inputId}
          rows={2}
          value={text}
          maxLength={MAX_TEXT_LENGTH}
          placeholder="Add a note for your team…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        <div className="notes-panel__actions">
          <span className="muted small">Only your team sees notes.</span>
          <button type="submit" className="btn btn--small btn--note" disabled={busy || !text.trim()}>
            {busy ? "Saving…" : "Add note"}
          </button>
        </div>
      </form>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      {sorted.length > 0 && (
        <ul className="notes-panel__list">
          {sorted.map((n) => (
            <NoteItem key={n.id} note={n} conversationId={conversationId} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function NoteItem({ note, conversationId, now }: { note: Note; conversationId: string; now: number }) {
  const client = useClient();
  const { user, role } = useAgent();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const author = note.authorName || (note.authorUid === user.uid ? "You" : "Agent");

  const onDelete = async () => {
    if (!window.confirm("Delete this internal note?")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteNote(client, conversationId, note.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <li className="note" aria-label={`Internal note by ${author}`}>
      <div className="note__meta">
        <span className="note__label">{author}</span>
        <time dateTime={new Date(note.createdAt).toISOString()} title={formatFull(note.createdAt)}>
          {formatShort(note.createdAt, now)}
        </time>
        {canDeleteNote(note, user.uid, role) && (
          <button type="button" className="note__delete" onClick={() => void onDelete()} disabled={busy} aria-label="Delete note">
            Delete
          </button>
        )}
      </div>
      <p className="note__text">{note.text}</p>
      {error && <p className="error-text small">{error}</p>}
    </li>
  );
}
