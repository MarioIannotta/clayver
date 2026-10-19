import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** A small colored dot before the label (e.g. a priority). */
  color?: string;
  /** Secondary text under the label in the menu. */
  description?: string;
}

/**
 * A styled replacement for `<select>`: a button that opens a listbox menu.
 * Keyboard: arrows/Home/End move, Enter/Space choose, Escape closes, typing jumps to a label.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  id,
  label,
  placeholder = "Select…",
  disabled,
  size = "normal",
  icon,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  id?: string;
  /** Accessible name when no visible `<label htmlFor={id}>` exists. */
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: "normal" | "small";
  icon?: ReactNode;
}) {
  const autoId = useId();
  const buttonId = id ?? `${autoId}-button`;
  const listId = `${autoId}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const show = () => {
    setActive(Math.max(0, selectedIndex));
    setOpen(true);
    requestAnimationFrame(() => list.current?.focus());
  };
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const choose = (i: number) => {
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
    close();
  };

  const typeAhead = (key: string) => {
    const now = Date.now();
    typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + key.toLowerCase(), at: now };
    const i = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
    if (i >= 0) setActive(i);
  };

  const onButtonKey = (e: KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      show();
    }
  };
  const onListKey = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((i) => Math.min(last, i + 1)),
      ArrowUp: () => setActive((i) => Math.max(0, i - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => choose(active),
      " ": () => choose(active),
      Escape: close,
      Tab: () => setOpen(false),
    };
    const handler = keys[e.key];
    if (handler) {
      if (e.key !== "Tab") e.preventDefault();
      handler();
    } else if (e.key.length === 1) {
      typeAhead(e.key);
    }
  };

  return (
    <div ref={root} className={`select ${size === "small" ? "select--small" : ""} ${open ? "is-open" : ""}`}>
      <button
        ref={button}
        id={buttonId}
        type="button"
        className="select__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onButtonKey}
      >
        {icon}
        {selected?.color && <span className="select__dot" style={{ background: selected.color }} aria-hidden="true" />}
        <span className={`select__value ${selected ? "" : "is-placeholder"}`}>{selected?.label ?? placeholder}</span>
        <svg className="select__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul
          ref={list}
          id={listId}
          className="select__menu"
          role="listbox"
          tabIndex={-1}
          aria-labelledby={label ? undefined : buttonId}
          aria-label={label}
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onListKey}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              data-index={i}
              role="option"
              aria-selected={o.value === value}
              className={`select__option ${i === active ? "is-active" : ""}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              {o.color && <span className="select__dot" style={{ background: o.color }} aria-hidden="true" />}
              <span className="select__option-text">
                <span>{o.label}</span>
                {o.description && <span className="select__option-description">{o.description}</span>}
              </span>
              {o.value === value && (
                <svg className="select__check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
