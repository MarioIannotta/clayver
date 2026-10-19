import { useEffect, useState } from "react";
import {
  DEFAULT_TRIAGE_OPTIONS,
  errorMessage,
  MAX_TRIAGE_NAME_LENGTH,
  MAX_TRIAGE_OPTIONS,
  resetTriageOptions,
  saveTriageOptions,
  TAG_PALETTE,
  triageOptionId,
  type TriageKind,
  type TriageOption,
} from "@clayver/core";
import { useClient } from "../clayver";
import { useTriageOptions } from "../lib/triage";
import { ErrorBanner, Spinner } from "./ui";
import { ColorSwatches } from "./TagSettings";

const LISTS: { kind: TriageKind; title: string; noun: string }[] = [
  { kind: "priority", title: "Priority", noun: "priority" },
  { kind: "stage", title: "Status", noun: "status" },
];

/** Settings: edit the workspace's priority and status lists. */
export function TriageSettings() {
  const options = useTriageOptions();
  return (
    <section className="card" aria-labelledby="triage-title" id="priority-status">
      <h2 id="triage-title">Priority and status</h2>
      <p className="muted small">
        The choices agents pick from on each conversation. Customers never see them. Conversations set to a choice you
        remove show no value.
      </p>
      <ErrorBanner error={options.error} />
      {options.loading ? (
        <Spinner label="Loading priority and status" />
      ) : (
        <div className="triage-settings">
          {LISTS.map((l) => (
            <TriageListEditor key={l.kind} kind={l.kind} title={l.title} noun={l.noun} saved={options.data[l.kind]} />
          ))}
        </div>
      )}
    </section>
  );
}

function sameList(a: TriageOption[], b: readonly TriageOption[]): boolean {
  return a.length === b.length && a.every((o, i) => o.id === b[i]!.id && o.name === b[i]!.name && o.color.toUpperCase() === b[i]!.color.toUpperCase());
}

function TriageListEditor({ kind, title, noun, saved }: { kind: TriageKind; title: string; noun: string; saved: TriageOption[] }) {
  const client = useClient();
  const [draft, setDraft] = useState<TriageOption[]>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  // Follow the stored list (loaded, or changed by a teammate) while there are no local edits.
  const savedKey = JSON.stringify(saved);
  const [baseKey, setBaseKey] = useState(savedKey);
  const dirty = !sameList(draft, saved);
  useEffect(() => {
    if (savedKey !== baseKey) {
      if (!dirty || busy) setDraft(saved);
      setBaseKey(savedKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const isDefault = sameList(saved, DEFAULT_TRIAGE_OPTIONS[kind]);
  const edit = (next: TriageOption[]) => {
    setDraft(next);
    setSavedNotice(false);
  };
  const update = (i: number, patch: Partial<TriageOption>) => edit(draft.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const move = (i: number, by: number) => {
    const next = [...draft];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item!);
    edit(next);
  };
  const add = () =>
    edit([
      ...draft,
      {
        id: triageOptionId(`new ${noun}`, draft.map((o) => o.id)),
        name: "",
        color: TAG_PALETTE[draft.length % TAG_PALETTE.length]!,
        order: draft.length,
      },
    ]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setSavedNotice(false);
    try {
      await action();
      setSavedNotice(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      // New rows get an id from their name, so it reads well in URLs (?priority=urgent).
      const taken = draft.filter((o) => saved.some((s) => s.id === o.id)).map((o) => o.id);
      const named = draft.map((o) => {
        if (saved.some((s) => s.id === o.id)) return o;
        const id = triageOptionId(o.name || noun, taken);
        taken.push(id);
        return { ...o, id };
      });
      await saveTriageOptions(client, kind, named);
    });

  return (
    <div className="triage-list">
      <h3 className="triage-list__title">{title}</h3>
      <ol className="triage-list__rows">
        {draft.map((o, i) => (
          <li key={o.id} className="triage-list__row">
            <div className="triage-list__line">
              <span className="select__dot" style={{ background: o.color }} aria-hidden="true" />
              <input
                type="text"
                aria-label={`${title} ${i + 1} name`}
                placeholder={`Name this ${noun}`}
                value={o.name}
                maxLength={MAX_TRIAGE_NAME_LENGTH}
                onChange={(e) => update(i, { name: e.target.value })}
                disabled={busy}
              />
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() => move(i, -1)}
                disabled={busy || i === 0}
                aria-label={`Move ${o.name || "option"} up`}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() => move(i, 1)}
                disabled={busy || i === draft.length - 1}
                aria-label={`Move ${o.name || "option"} down`}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn btn--small btn--ghost btn--danger"
                onClick={() => edit(draft.filter((_, j) => j !== i))}
                disabled={busy || draft.length === 1}
                aria-label={`Remove ${o.name || "option"}`}
              >
                Remove
              </button>
            </div>
            <ColorSwatches label={`Color of ${o.name || "option"}`} value={o.color} disabled={busy} onChange={(color) => update(i, { color })} />
          </li>
        ))}
      </ol>
      <div className="triage-list__actions">
        <button type="button" className="btn btn--small" onClick={add} disabled={busy || draft.length >= MAX_TRIAGE_OPTIONS}>
          Add {noun}
        </button>
        <span className="triage-list__spacer" />
        {!isDefault && !dirty && (
          <button type="button" className="btn btn--small btn--ghost" onClick={() => void run(() => resetTriageOptions(client, kind))} disabled={busy}>
            Reset to defaults
          </button>
        )}
        {dirty && (
          <button type="button" className="btn btn--small btn--ghost" onClick={() => edit(saved)} disabled={busy}>
            Discard
          </button>
        )}
        <button type="button" className="btn btn--small btn--primary" onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {savedNotice && !dirty && <p className="small success-text">Saved</p>}
      {error && <p className="error-text small">{error}</p>}
    </div>
  );
}
