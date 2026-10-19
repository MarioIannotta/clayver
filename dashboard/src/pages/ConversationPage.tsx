import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  assignConversation,
  customerLabel,
  errorMessage,
  markReadAsAgent,
  needsAgentRead,
  setConversationPriority,
  setConversationStage,
  setConversationStatus,
} from "@clayver/core";
import { useClient } from "../clayver";
import { useAgent } from "../auth";
import {
  useAgents,
  useConversation,
  useConversationTags,
  useCustomer,
  useMessages,
  useNotes,
  usePageVisible,
  useReadMarkers,
  useTags,
  useTriage,
} from "../lib/hooks";
import { triageSelectOptions, useTriageOptions } from "../lib/triage";
import { Select } from "../components/Select";
import { inboxSearch, readInboxFilters } from "../lib/inbox";
import { MessageList } from "../components/MessageList";
import { TagPicker } from "../components/Tags";
import { Composer } from "../components/Composer";
import { CustomerPanel } from "../components/CustomerPanel";
import { Badge, EmptyState, ErrorBanner, Spinner } from "../components/ui";

export function ConversationPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [search] = useSearchParams();
  const client = useClient();
  const { user } = useAgent();
  const conversation = useConversation(conversationId);
  const messages = useMessages(conversationId);
  const reads = useReadMarkers(conversationId);
  const notes = useNotes(conversationId);
  const tags = useTags();
  const tagIds = useConversationTags(conversationId);
  const triage = useTriage();
  const triageOptions = useTriageOptions();
  const customer = useCustomer(conversation.data?.customerId);
  const { byUid } = useAgents();
  const visible = usePageVisible();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);

  const c = conversation.data;
  const label = c ? customerLabel(customer.data, c.customerId) : "";

  // Mark read while the conversation is on screen. One write per newest
  // customer message, so a lagging unread counter cannot cause a write loop.
  const newestCustomer = useMemo(() => {
    for (let i = messages.messages.length - 1; i >= 0; i--) {
      const m = messages.messages[i]!;
      if (m.senderType === "customer") return m;
    }
    return undefined;
  }, [messages.messages]);
  const markedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!c || !conversationId || !visible || messages.loading || reads.loading) return;
    if (!needsAgentRead(c, reads.data, newestCustomer?.createdAt)) return;
    const key = `${conversationId}:${newestCustomer?.id ?? c.lastMessage?.createdAt ?? ""}`;
    if (markedKey.current === key) return;
    markedKey.current = key;
    markReadAsAgent(client, conversationId).catch(() => {
      markedKey.current = null;
    });
  }, [client, c, conversationId, visible, messages.loading, reads.loading, reads.data, newestCustomer]);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const inboxQuery = inboxSearch(readInboxFilters(search));
  const backTo = `/conversations${inboxQuery}`;

  if (conversation.loading) {
    return (
      <div className="center-fill">
        <Spinner label="Loading conversation" />
      </div>
    );
  }
  if (conversation.error) {
    return (
      <div className="center-fill">
        <ErrorBanner error={conversation.error} />
      </div>
    );
  }
  if (!c || !conversationId) {
    return (
      <div className="center-fill">
        <EmptyState title="Conversation not found">
          <Link to={backTo}>Back to the inbox</Link>
        </EmptyState>
      </div>
    );
  }

  const assignee = c.assigneeUid ? byUid.get(c.assigneeUid) : undefined;
  const mine = c.assigneeUid === user.uid;

  return (
    <div className={`conversation ${showPanel ? "conversation--panel-open" : ""}`}>
      <div className="conversation__main">
        <header className="conversation__header">
          <Link to={backTo} className="btn btn--ghost btn--small conversation__back" aria-label="Back to conversations">
            ←
          </Link>
          <div className="conversation__title">
            <h1>{label}</h1>
            <div className="conversation__subtitle">
              <Badge tone={c.status === "open" ? "success" : "neutral"}>{c.status === "open" ? "Open" : "Closed"}</Badge>
              <span className="muted small">
                {mine ? "Assigned to you" : assignee ? `Assigned to ${assignee.displayName || assignee.email}` : c.assigneeUid ? "Assigned" : "Unassigned"}
              </span>
            </div>
            <div className="conversation__triage">
              <Select
                size="small"
                label="Priority"
                value={triageOptions.byId.priority.has(triage.data[conversationId]?.priority ?? "") ? triage.data[conversationId]!.priority! : ""}
                options={triageSelectOptions(triageOptions.data.priority, "No priority")}
                onChange={(p) => void run("priority", () => setConversationPriority(client, conversationId, p || null))}
              />
              <Select
                size="small"
                label="Status"
                value={triageOptions.byId.stage.has(triage.data[conversationId]?.stage ?? "") ? triage.data[conversationId]!.stage! : ""}
                options={triageSelectOptions(triageOptions.data.stage, "No status")}
                onChange={(st) => void run("stage", () => setConversationStage(client, conversationId, st || null))}
              />
              <TagPicker
                conversationId={conversationId}
                catalog={tags.data}
                selectedIds={tagIds.data}
                onError={setActionError}
              />
            </div>
          </div>
          <div className="conversation__actions">
            {!mine ? (
              <button
                type="button"
                className="btn btn--small"
                disabled={busy !== null}
                onClick={() => run("assign", () => assignConversation(client, conversationId, user.uid))}
              >
                {busy === "assign" ? "Assigning…" : "Assign to me"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--small btn--ghost"
                disabled={busy !== null}
                onClick={() => run("assign", () => assignConversation(client, conversationId, null))}
              >
                {busy === "assign" ? "Updating…" : "Unassign"}
              </button>
            )}
            {c.status === "open" ? (
              <button
                type="button"
                className="btn btn--small btn--primary"
                disabled={busy !== null}
                onClick={() => run("status", () => setConversationStatus(client, conversationId, "closed"))}
              >
                {busy === "status" ? "Closing…" : "Close"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--small btn--primary"
                disabled={busy !== null}
                onClick={() => run("status", () => setConversationStatus(client, conversationId, "open"))}
              >
                {busy === "status" ? "Reopening…" : "Reopen"}
              </button>
            )}
            <button
              type="button"
              className="btn btn--small btn--ghost conversation__panel-toggle"
              aria-expanded={showPanel}
              aria-controls="customer-panel"
              onClick={() => setShowPanel((v) => !v)}
            >
              Details
            </button>
          </div>
        </header>
        <ErrorBanner error={actionError} onDismiss={() => setActionError(null)} />
        <MessageList
          messages={messages.messages}
          loading={messages.loading}
          loadingOlder={messages.loadingOlder}
          hasMore={messages.hasMore}
          error={messages.error}
          reads={reads.data}
          customerLabel={label}
          onLoadOlder={() => void messages.loadOlder()}
          conversationId={conversationId}
        />
        <Composer key={conversationId} conversationId={conversationId} customerId={c.customerId} closed={c.status === "closed"} />
      </div>
      <div id="customer-panel" className="conversation__panel">
        <CustomerPanel
          conversation={c}
          customer={customer.data}
          loading={customer.loading}
          error={customer.error}
          assignee={assignee}
          inboxQuery={inboxQuery}
          notes={notes.data}
        />
      </div>
    </div>
  );
}
