import { useId, useState, type CSSProperties, type FormEvent } from "react";
import {
  countTagConversations,
  createTag,
  deleteTag,
  errorMessage,
  MAX_TAG_NAME_LENGTH,
  TAG_PALETTE,
  updateTag,
  type Tag,
} from "@clayver/core";
import { useClient } from "../clayver";
import { useAgent } from "../auth";
import { useTags } from "../lib/hooks";
import { EmptyState, ErrorBanner, Spinner } from "./ui";
import { TagChip } from "./Tags";

/** Palette swatches as a radio group. */
export function ColorSwatches({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string;
  onChange: (color: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {TAG_PALETTE.map((color) => (
        <label key={color} className="swatch" style={{ "--swatch": color } as CSSProperties} title={color}>
          <input
            type="radio"
            name={name}
            value={color}
            checked={value.toUpperCase() === color}
            onChange={() => onChange(color)}
            disabled={disabled}
            className="visually-hidden"
          />
          <span className="swatch__dot" aria-hidden="true" />
          <span className="visually-hidden">{color}</span>
        </label>
      ))}
    </div>
  );
}

export function TagSettings() {
  const client = useClient();
  const tags = useTags();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const nameId = useId();

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { tag, created } = await createTag(client, { name });
      setName("");
      if (!created) setNotice(`“${tag.name}” already exists.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="tags-title" id="tags">
      <h2 id="tags-title">Tags</h2>
      <p className="muted small">
        Tags organise conversations and filter the inbox. Customers never see them. Renaming keeps the tag on every
        conversation.
      </p>
      <form className="inline-form" onSubmit={onCreate}>
        <label htmlFor={nameId} className="visually-hidden">
          New tag name
        </label>
        <input
          id={nameId}
          type="text"
          placeholder="New tag name"
          maxLength={MAX_TAG_NAME_LENGTH}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn" disabled={busy || !name.trim()}>
          {busy ? "Adding…" : "Add tag"}
        </button>
      </form>
      <ErrorBanner error={error ?? tags.error} onDismiss={error ? () => setError(null) : undefined} />
      {notice && <p className="banner banner--info">{notice}</p>}
      {tags.loading ? (
        <Spinner label="Loading tags" />
      ) : tags.data.length === 0 ? (
        <EmptyState title="No tags yet" />
      ) : (
        <ul className="settings-list">
          {tags.data.map((t) => (
            <TagRow key={t.id} tag={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TagRow({ tag }: { tag: Tag }) {
  const client = useClient();
  const { role } = useAgent();
  const [name, setName] = useState(tag.name);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const inputId = useId();

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onRename = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (name.trim() !== tag.name) await updateTag(client, tag.id, { name });
      setEditing(false);
    });
  };

  const askDelete = () =>
    void run(async () => {
      setConfirmDelete(await countTagConversations(client, tag.id));
    });

  return (
    <li className="settings-list__row tag-row">
      <div className="tag-row__main">
        {editing ? (
          <form className="inline-form" onSubmit={onRename}>
            <label htmlFor={inputId} className="visually-hidden">
              Tag name
            </label>
            <input
              id={inputId}
              type="text"
              value={name}
              maxLength={MAX_TAG_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setName(tag.name);
                  setEditing(false);
                }
              }}
            />
            <button type="submit" className="btn btn--small btn--primary" disabled={busy || !name.trim()}>
              Save
            </button>
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => {
                setName(tag.name);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <TagChip tag={tag} />
            <code className="muted small">{tag.id}</code>
            <span className="tag-row__actions">
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() => {
                  setName(tag.name);
                  setEditing(true);
                }}
                aria-label={`Rename ${tag.name}`}
              >
                Rename
              </button>
              {role === "admin" && (
                <button
                  type="button"
                  className="btn btn--small btn--ghost btn--danger"
                  onClick={askDelete}
                  disabled={busy}
                  aria-label={`Delete ${tag.name}`}
                >
                  Delete
                </button>
              )}
            </span>
          </>
        )}
      </div>
      <ColorSwatches
        label={`Color of ${tag.name}`}
        value={tag.color}
        disabled={busy}
        onChange={(color) => void run(() => updateTag(client, tag.id, { color }))}
      />
      {confirmDelete !== null && (
        <div className="danger-confirm" role="alertdialog" aria-label={`Delete ${tag.name}`}>
          <p className="small">
            Delete <strong>{tag.name}</strong>?{" "}
            {confirmDelete === 0
              ? "No conversation uses it."
              : `It is used by ${confirmDelete} conversation${confirmDelete === 1 ? "" : "s"}, and will be removed from ${confirmDelete === 1 ? "it" : "them"}.`}
          </p>
          <div className="block-form__actions">
            <button
              type="button"
              className="btn btn--small btn--danger-solid"
              disabled={busy}
              onClick={() => void run(() => deleteTag(client, tag.id))}
            >
              Delete tag
            </button>
            <button type="button" className="btn btn--small btn--ghost" onClick={() => setConfirmDelete(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="error-text small">{error}</p>}
    </li>
  );
}
