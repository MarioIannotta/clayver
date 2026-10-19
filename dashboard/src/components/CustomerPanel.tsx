import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  activeBlock,
  BLOCK_DURATIONS,
  BLOCK_REASON_LABELS,
  blockCustomer,
  customerExportFileName,
  customerEmail,
  customerLabel,
  customerUserId,
  deleteCustomer,
  errorMessage,
  exportCustomer,
  MANUAL_BLOCK_REASONS,
  otherProperties,
  unblockCustomer,
  type Agent,
  type Conversation,
  type Customer,
  type Note,
  type ManualBlockReason,
} from "@clayver/core";
import { useClient } from "../clayver";
import { useAgent } from "../auth";
import { useCustomerConversations, useModeration, useNow } from "../lib/hooks";
import { formatFull, formatShort } from "../lib/format";
import { Avatar, Badge, ErrorBanner, Spinner } from "./ui";
import { Select } from "./Select";
import { NotesPanel } from "./NotesPanel";

export function CustomerPanel({
  conversation,
  customer,
  loading,
  error,
  assignee,
  inboxQuery,
  notes,
}: {
  conversation: Conversation;
  customer: Customer | null;
  loading: boolean;
  error: { message: string } | null;
  assignee?: Agent;
  /** Inbox filters to keep on links (`?status=…&tag=…`). */
  inboxQuery: string;
  notes: Note[];
}) {
  const { role } = useAgent();
  const label = customerLabel(customer, conversation.customerId);
  const email = customerEmail(customer);
  const userId = customerUserId(customer);
  const props = otherProperties(customer);

  return (
    <aside className="customer-panel" aria-label="Customer details">
      <div className="customer-panel__header">
        <Avatar label={label} size={44} />
        <div>
          <h2 className="customer-panel__name">{label}</h2>
          {email && email !== label && (
            <a href={`mailto:${email}`} className="small">
              {email}
            </a>
          )}
        </div>
      </div>
      <NotesPanel conversationId={conversation.id} notes={notes} />
      <ErrorBanner error={error} />
      {loading ? (
        <Spinner label="Loading customer" />
      ) : (
        <>
          <h3 className="customer-panel__section">Customer</h3>
          <dl className="kv">
            {userId && (
              <>
                <dt>User ID</dt>
                <dd>
                  <code className="break">{userId}</code>
                </dd>
              </>
            )}
            <dt>Customer id</dt>
            <dd>
              <code className="break">{conversation.customerId}</code>
            </dd>
            {customer?.account && (
              <>
                <dt>Account</dt>
                <dd>
                  {customer.account.anonymous ? (
                    "Anonymous visitor"
                  ) : (
                    <>
                      {customer.account.email ?? customer.account.displayName ?? "Signed in"}{" "}
                      {customer.account.email && (
                        <Badge>{customer.account.emailVerified ? "verified" : "unverified"}</Badge>
                      )}
                    </>
                  )}
                </dd>
              </>
            )}
            {customer?.lastSeenAt && (
              <>
                <dt>Last seen</dt>
                <dd>{formatFull(customer.lastSeenAt)}</dd>
              </>
            )}
            {customer?.createdAt && (
              <>
                <dt>First seen</dt>
                <dd>{formatFull(customer.createdAt)}</dd>
              </>
            )}
            {customer?.notifications?.enabled !== undefined && (
              <>
                <dt>Push</dt>
                <dd>{customer.notifications.enabled ? "Enabled" : "Disabled"}</dd>
              </>
            )}
          </dl>

          <h3 className="customer-panel__section">Properties</h3>
          {props.length === 0 ? (
            <p className="muted small">No custom properties.</p>
          ) : (
            <dl className="kv">
              {props.map(([key, value]) => (
                <div key={key} className="kv__row">
                  <dt>{key}</dt>
                  <dd className="break">{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}

          <h3 className="customer-panel__section">Conversation</h3>
          <dl className="kv">
            <dt>Status</dt>
            <dd>{conversation.status === "open" ? "Open" : "Closed"}</dd>
            <dt>Assignee</dt>
            <dd>{assignee ? assignee.displayName || assignee.email : conversation.assigneeUid ? "Unknown agent" : "Unassigned"}</dd>
            <dt>Started</dt>
            <dd>{formatFull(conversation.createdAt)}</dd>
            {conversation.closedAt && conversation.status === "closed" && (
              <>
                <dt>Closed</dt>
                <dd>{formatFull(conversation.closedAt)}</dd>
              </>
            )}
            <dt>Id</dt>
            <dd>
              <code className="break">{conversation.id}</code>
            </dd>
          </dl>
          <Conversations conversation={conversation} inboxQuery={inboxQuery} />
          <BlockStatus customerId={conversation.customerId} />
          <MoreOptions customerId={conversation.customerId} label={label} inboxQuery={inboxQuery} isAdmin={role === "admin"} />
        </>
      )}
    </aside>
  );
}

/** All of the customer's conversations (open and closed), newest first, this one included. */
function Conversations({ conversation, inboxQuery }: { conversation: Conversation; inboxQuery: string }) {
  const list = useCustomerConversations(conversation.customerId);
  const now = useNow();
  const all = list.data.some((c) => c.id === conversation.id) ? list.data : [conversation, ...list.data];

  return (
    <section aria-labelledby="conversations-title">
      <h3 className="customer-panel__section" id="conversations-title">
        Conversations{all.length > 1 ? ` (${all.length})` : ""}
      </h3>
      <ErrorBanner error={list.error} />
      {list.loading ? (
        <Spinner label="Loading conversations" />
      ) : (
        <ul className="mini-conversations">
          {all.map((c) => {
            const lm = c.lastMessage;
            const at = c.updatedAt ?? lm?.createdAt ?? c.createdAt;
            const preview = lm ? lm.text || (lm.hasAttachment ? "Photo" : "") : "No messages yet";
            const current = c.id === conversation.id;
            const body = (
              <>
                <span className="mini-conversation__top">
                  <span className="mini-conversation__badges">
                    <Badge tone={c.status === "open" ? "success" : "neutral"}>{c.status === "open" ? "Open" : "Closed"}</Badge>
                    {current && <span className="mini-conversation__current">This conversation</span>}
                  </span>
                  <time className="muted small" dateTime={new Date(at).toISOString()} title={formatFull(at)}>
                    {formatShort(at, now)}
                  </time>
                </span>
                <span className="mini-conversation__preview">
                  {lm?.senderType === "agent" ? "Agent: " : ""}
                  {preview}
                </span>
              </>
            );
            return (
              <li key={c.id}>
                {current ? (
                  <div className="mini-conversation is-current" aria-current="page">
                    {body}
                  </div>
                ) : (
                  <Link to={`/conversations/${encodeURIComponent(c.id)}${inboxQuery}`} className="mini-conversation">
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The customer's active block (manual or automatic), with Unblock. Nothing when not blocked. */
function BlockStatus({ customerId }: { customerId: string }) {
  const client = useClient();
  const moderation = useModeration(customerId);
  const now = useNow(15_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const block = activeBlock(moderation.data, now);
  if (!block && !moderation.error) return null;

  const unblock = async () => {
    setBusy(true);
    setError(null);
    try {
      await unblockCustomer(client, customerId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Block status">
      <ErrorBanner error={error ?? moderation.error} onDismiss={error ? () => setError(null) : undefined} />
      {block && (
        <div className="block-status" role="status">
          <p className="block-status__title">
            Blocked{block.reason === "rate_limit" ? " automatically" : ""}: {BLOCK_REASON_LABELS[block.reason] ?? block.reason}
          </p>
          <p className="small">
            {block.until ? `Until ${formatFull(block.until)}` : "Until someone unblocks them"}
            {block.by === "system" ? " · exceeded the rate limit" : ""}
          </p>
          <p className="small muted">The customer can read their history but can't send messages or start conversations.</p>
          <button type="button" className="btn btn--small" disabled={busy} onClick={() => void unblock()}>
            {busy ? "Unblocking…" : "Unblock"}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Collapsed "More options": block the customer, and (admins) export or delete
 * everything stored about them.
 */
function MoreOptions({
  customerId,
  label,
  inboxQuery,
  isAdmin,
}: {
  customerId: string;
  label: string;
  inboxQuery: string;
  isAdmin: boolean;
}) {
  const client = useClient();
  const navigate = useNavigate();
  const moderation = useModeration(customerId);
  const now = useNow(15_000);
  const blocked = activeBlock(moderation.data, now) !== null;
  const [panel, setPanel] = useState<"block" | "delete" | null>(null);
  const [busy, setBusy] = useState<"block" | "export" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<ManualBlockReason>("spam");
  const [duration, setDuration] = useState<string>(BLOCK_DURATIONS[0]!.id);
  const [typed, setTyped] = useState("");
  const reasonId = useId();
  const durationId = useId();
  const confirmId = useId();
  const confirmWord = "DELETE";

  const onBlock = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("block");
    setError(null);
    try {
      const ms = BLOCK_DURATIONS.find((d) => d.id === duration)?.ms ?? null;
      await blockCustomer(client, customerId, { reason, durationMs: ms });
      setPanel(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const onExport = async () => {
    setBusy("export");
    setError(null);
    try {
      const data = await exportCustomer(client, customerId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = customerExportFileName(customerId);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (e: FormEvent) => {
    e.preventDefault();
    if (typed.trim() !== confirmWord) return;
    setBusy("delete");
    setError(null);
    try {
      await deleteCustomer(client, customerId);
      navigate(`/conversations${inboxQuery}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  const toggle = (next: "block" | "delete") => {
    setPanel((p) => (p === next ? null : next));
    setTyped("");
    setError(null);
  };

  return (
    <details className="more-options">
      <summary className="more-options__summary">More options</summary>
      <div className="more-options__body">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <div className="customer-data__actions">
          <button
            type="button"
            className="btn btn--small"
            aria-expanded={panel === "block"}
            onClick={() => toggle("block")}
            disabled={busy !== null || blocked}
            title={blocked ? "The customer is already blocked" : undefined}
          >
            Block
          </button>
          {isAdmin && (
            <>
              <button type="button" className="btn btn--small" onClick={() => void onExport()} disabled={busy !== null}>
                {busy === "export" ? "Exporting…" : "Export data"}
              </button>
              <button
                type="button"
                className="btn btn--small btn--danger"
                aria-expanded={panel === "delete"}
                onClick={() => toggle("delete")}
                disabled={busy !== null}
              >
                Delete customer data
              </button>
            </>
          )}
        </div>
        {panel === "block" && !blocked && (
          <form className="block-form" onSubmit={(e) => void onBlock(e)}>
            <label htmlFor={reasonId} className="field__label">
              Reason
            </label>
            <Select<ManualBlockReason>
              id={reasonId}
              size="small"
              value={reason}
              onChange={setReason}
              options={MANUAL_BLOCK_REASONS.map((r) => ({ value: r, label: BLOCK_REASON_LABELS[r] }))}
            />
            <label htmlFor={durationId} className="field__label">
              Duration
            </label>
            <Select
              id={durationId}
              size="small"
              value={duration}
              onChange={setDuration}
              options={BLOCK_DURATIONS.map((d) => ({ value: d.id, label: d.label }))}
            />
            <div className="block-form__actions">
              <button type="submit" className="btn btn--small btn--danger" disabled={busy !== null}>
                {busy === "block" ? "Blocking…" : "Block customer"}
              </button>
              <button type="button" className="btn btn--small btn--ghost" onClick={() => setPanel(null)} disabled={busy !== null}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {panel === "delete" && (
          <form className="danger-confirm" onSubmit={(e) => void onDelete(e)}>
            <p className="small">
              This permanently deletes <strong>{label}</strong>: their profile, every conversation with its messages, notes
              and tags, and their uploaded files. It can&apos;t be undone.
            </p>
            <label htmlFor={confirmId} className="field__label">
              Type {confirmWord} to confirm
            </label>
            <input
              id={confirmId}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <div className="block-form__actions">
              <button type="submit" className="btn btn--small btn--danger-solid" disabled={typed.trim() !== confirmWord || busy !== null}>
                {busy === "delete" ? "Deleting…" : "Delete permanently"}
              </button>
              <button type="button" className="btn btn--small btn--ghost" onClick={() => setPanel(null)} disabled={busy !== null}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}
