import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import type { SavedReply } from "@clayver/core";

/**
 * The list of saved replies shown above the composer. Controlled: the
 * composer owns the search text and the active row, so the same keyboard
 * handling works from the textarea ("/" shortcut) and from the search box.
 */
export function SavedReplyPicker({
  replies,
  loading,
  active,
  onActiveChange,
  onPick,
  search,
  onSearchChange,
  onSearchKeyDown,
  listId,
}: {
  replies: SavedReply[];
  loading: boolean;
  active: number;
  onActiveChange: (index: number) => void;
  onPick: (reply: SavedReply) => void;
  /** Shown when the picker was opened with the button (not with "/"). */
  search?: string;
  onSearchChange?: (value: string) => void;
  onSearchKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  listId: string;
}) {
  const searchId = useId();
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    list.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="popover saved-reply-picker" role="dialog" aria-label="Saved replies">
      {onSearchChange && (
        <>
          <label htmlFor={searchId} className="visually-hidden">
            Search saved replies
          </label>
          <input
            id={searchId}
            type="text"
            className="popover__search"
            placeholder="Search saved replies…"
            value={search ?? ""}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onSearchKeyDown}
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={replies[active] ? `${listId}-${active}` : undefined}
          />
        </>
      )}
      <ul className="popover__list" role="listbox" id={listId} ref={list}>
        {replies.length === 0 && (
          <li className="popover__empty">
            {loading ? (
              "Loading…"
            ) : search || !onSearchChange ? (
              "No saved reply matches."
            ) : (
              <>
                No saved replies yet. Add them in <Link to="/settings#saved-replies">Settings</Link>.
              </>
            )}
          </li>
        )}
        {replies.map((r, i) => (
          <li
            key={r.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={`popover__option popover__option--stacked ${i === active ? "is-active" : ""}`}
            onMouseEnter={() => onActiveChange(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(r)}
          >
            <span className="saved-reply-picker__title">{r.title}</span>
            <span className="saved-reply-picker__text">{r.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
