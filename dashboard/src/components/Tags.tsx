import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  addConversationTag,
  createTag,
  errorMessage,
  filterTags,
  findTagByName,
  MAX_TAG_NAME_LENGTH,
  removeConversationTag,
  type Tag,
} from "@clayver/core";
import { useClient } from "../clayver";

export function TagChip({ tag, onRemove }: { tag: Pick<Tag, "name" | "color">; onRemove?: () => void }) {
  return (
    <span className="tag-chip" style={{ "--tag-color": tag.color } as CSSProperties}>
      <span className="tag-chip__dot" aria-hidden="true" />
      <span className="tag-chip__name">{tag.name}</span>
      {onRemove && (
        <button type="button" className="tag-chip__remove" onClick={onRemove} aria-label={`Remove tag ${tag.name}`}>
          ×
        </button>
      )}
    </span>
  );
}

export function TagChips({ tags, max }: { tags: Tag[]; max?: number }) {
  if (tags.length === 0) return null;
  const shown = max !== undefined ? tags.slice(0, max) : tags;
  const hidden = tags.length - shown.length;
  return (
    <span className="tag-chips" aria-label="Tags">
      {shown.map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
      {hidden > 0 && (
        <span className="tag-chip tag-chip--more" title={tags.slice(shown.length).map((t) => t.name).join(", ")}>
          +{hidden}
        </span>
      )}
    </span>
  );
}

type Option = { kind: "tag"; tag: Tag } | { kind: "create"; name: string };

/**
 * A select-style box showing the conversation's tags, with a popover to search
 * the catalog, toggle tags, and create a tag when no name matches exactly.
 */
export function TagPicker({
  conversationId,
  catalog,
  selectedIds,
  onError,
}: {
  conversationId: string;
  catalog: Tag[];
  selectedIds: string[];
  onError: (message: string) => void;
}) {
  const client = useClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = new Set(selectedIds);
  const selectedTags = catalog.filter((t) => selected.has(t.id));

  const trimmed = search.trim();
  const matches = filterTags(catalog, trimmed);
  const exact = trimmed ? findTagByName(catalog, trimmed) : undefined;
  const options: Option[] = matches.map((tag) => ({ kind: "tag", tag }));
  if (trimmed && !exact) options.push({ kind: "create", name: trimmed.slice(0, MAX_TAG_NAME_LENGTH) });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => setActive(0), [search, open]);

  const close = () => {
    setOpen(false);
    setSearch("");
    button.current?.focus();
  };

  const choose = async (option: Option | undefined) => {
    if (!option || busy) return;
    setBusy(true);
    try {
      if (option.kind === "tag") {
        if (selected.has(option.tag.id)) await removeConversationTag(client, conversationId, option.tag.id);
        else await addConversationTag(client, conversationId, option.tag.id);
      } else {
        const { tag } = await createTag(client, { name: option.name });
        await addConversationTag(client, conversationId, tag.id);
        setSearch("");
      }
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void choose(options[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className={`popover-anchor select select--small ${open ? "is-open" : ""}`} ref={root}>
      <button
        ref={button}
        type="button"
        className="select__button tag-box"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selectedTags.length ? `Tags: ${selectedTags.map((t) => t.name).join(", ")}` : "Tags"}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg className="tag-box__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
          <circle cx="7" cy="7" r="1.5" />
        </svg>
        {selectedTags.length === 0 ? (
          <span className="select__value is-placeholder">No tags</span>
        ) : (
          <span className="select__value tag-box__value">
            {selectedTags.slice(0, 2).map((t) => (
              <span key={t.id} className="tag-box__tag">
                <span className="select__dot" style={{ background: t.color }} aria-hidden="true" />
                {t.name}
              </span>
            ))}
            {selectedTags.length > 2 && <span className="tag-box__more">+{selectedTags.length - 2}</span>}
          </span>
        )}
        <svg className="select__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="popover tag-picker" role="dialog" aria-label="Tags">
          <input
            type="text"
            className="popover__search"
            placeholder="Search or create a tag…"
            value={search}
            maxLength={MAX_TAG_NAME_LENGTH + 10}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
            aria-label="Search tags"
          />
          <ul className="popover__list" role="listbox" id={listId} aria-multiselectable="true" aria-busy={busy}>
            {options.length === 0 && <li className="popover__empty">No tags yet. Type a name to create one.</li>}
            {options.map((o, i) => (
              <li
                key={o.kind === "tag" ? o.tag.id : "__create"}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.kind === "tag" ? selected.has(o.tag.id) : false}
                className={`popover__option ${i === active ? "is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void choose(o)}
              >
                {o.kind === "tag" ? (
                  <>
                    <span className="popover__check" aria-hidden="true">
                      {selected.has(o.tag.id) ? "✓" : ""}
                    </span>
                    <TagChip tag={o.tag} />
                  </>
                ) : (
                  <span className="popover__create">Create tag “{o.name}”</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
