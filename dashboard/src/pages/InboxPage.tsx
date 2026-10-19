import { useMemo } from "react";
import { Link, Outlet, useMatch, useSearchParams } from "react-router-dom";
import type { Conversation, ConversationStatus, Tag, TriageOption } from "@clayver/core";
import { customerLabel, tagsForIds } from "@clayver/core";
import { useAgent } from "../auth";
import { useAgents, useConversationList, useConversationTags, useCustomer, useNow, useTags, useTriage } from "../lib/hooks";
import { triageSelectOptions, useTriageOptions } from "../lib/triage";
import { Select, type SelectOption } from "../components/Select";
import { formatFull, formatShort } from "../lib/format";
import { inboxSearch, readInboxFilters } from "../lib/inbox";
import { Avatar, EmptyState, ErrorBanner, Spinner } from "../components/ui";
import { TagChips } from "../components/Tags";

const TABS: { status: ConversationStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "closed", label: "Closed" },
];

export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const filters = readInboxFilters(params);
  const { status, tag, priority, stage } = filters;
  const match = useMatch("/conversations/:conversationId");
  const selectedId = match?.params.conversationId;
  const list = useConversationList(status, tag);
  const { byUid } = useAgents();
  const tags = useTags();
  const now = useNow();
  const triage = useTriage();
  const triageOptions = useTriageOptions();
  const conversations = useMemo(
    () =>
      list.conversations.filter(
        (c) => (!priority || triage.data[c.id]?.priority === priority) && (!stage || triage.data[c.id]?.stage === stage),
      ),
    [list.conversations, triage.data, priority, stage],
  );
  const filtered = Boolean(tag || priority || stage);
  const tagOptions: SelectOption<string>[] = [
    { value: "", label: "Any tag" },
    ...(tag && !tags.byId.get(tag) ? [{ value: tag, label: tags.loading ? "Loading…" : `Deleted tag (${tag})` }] : []),
    ...tags.data.map((t) => ({ value: t.id, label: t.name, color: t.color })),
  ];
  const search = inboxSearch(filters);
  const statusWord = status === "open" ? "open" : "closed";

  return (
    <div className={`inbox ${selectedId ? "inbox--has-selection" : ""}`}>
      <section className="inbox__list" aria-label="Conversations">
        <div className="tabs" role="tablist" aria-label="Conversation status">
          {TABS.map((tab) => (
            <button
              key={tab.status}
              type="button"
              role="tab"
              id={`tab-${tab.status}`}
              aria-selected={status === tab.status}
              aria-controls="conversation-list"
              className="tabs__tab"
              onClick={() => setParams(inboxSearch({ ...filters, status: tab.status }))}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="inbox__filters">
          <Select
            size="small"
            label="Filter by priority"
            value={priority ?? ""}
            onChange={(p) => setParams(inboxSearch({ ...filters, priority: p || null }))}
            options={triageSelectOptions(triageOptions.data.priority, "Any priority")}
          />
          <Select
            size="small"
            label="Filter by status"
            value={stage ?? ""}
            onChange={(v) => setParams(inboxSearch({ ...filters, stage: v || null }))}
            options={triageSelectOptions(triageOptions.data.stage, "Any status")}
          />
          <Select
            size="small"
            label="Filter by tag"
            value={tag ?? ""}
            onChange={(v) => setParams(inboxSearch({ ...filters, tag: v || null }))}
            options={tagOptions}
          />
          {filtered && (
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => setParams(inboxSearch({ status, tag: null, priority: null, stage: null }))}
            >
              Clear
            </button>
          )}
        </div>
        <div id="conversation-list" role="tabpanel" aria-labelledby={`tab-${status}`} className="inbox__scroll">
          <ErrorBanner error={list.error} />
          {list.loading && conversations.length === 0 ? (
            <div className="center-pad">
              <Spinner label="Loading conversations" />
            </div>
          ) : conversations.length === 0 && !list.error ? (
            <EmptyState title={filtered ? `No ${statusWord} conversations match these filters` : `No ${statusWord} conversations`}>
              {filtered ? null : status === "open" ? "New customer messages will appear here in real time." : null}
            </EmptyState>
          ) : (
            <ul className="conversation-list">
              {conversations.map((c) => (
                <ConversationRow
                  key={c.id}
                  conversation={c}
                  selected={c.id === selectedId}
                  assigneeName={c.assigneeUid ? byUid.get(c.assigneeUid)?.displayName || byUid.get(c.assigneeUid)?.email || undefined : undefined}
                  now={now}
                  search={search}
                  catalog={tags.data}
                  priority={triageOptions.byId.priority.get(triage.data[c.id]?.priority ?? "")}
                  stage={triageOptions.byId.stage.get(triage.data[c.id]?.stage ?? "")}
                />
              ))}
            </ul>
          )}
          {list.hasMore && (
            <div className="center-pad">
              <button type="button" className="btn btn--small" onClick={list.loadMore} disabled={list.loading}>
                {list.loading ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      </section>
      <section className="inbox__detail">
        <Outlet />
      </section>
    </div>
  );
}

function ConversationRow({
  conversation: c,
  selected,
  assigneeName,
  now,
  search,
  catalog,
  priority,
  stage,
}: {
  conversation: Conversation;
  selected: boolean;
  assigneeName?: string;
  now: number;
  search: string;
  catalog: Tag[];
  priority?: TriageOption;
  stage?: TriageOption;
}) {
  const { user } = useAgent();
  const customer = useCustomer(c.customerId);
  const tagIds = useConversationTags(c.id);
  const rowTags = tagsForIds(catalog, tagIds.data);
  const label = customerLabel(customer.data, c.customerId);
  const unread = c.unread?.agent ?? 0;
  const lm = c.lastMessage;
  const preview = lm
    ? `${lm.senderType === "agent" ? "Agent: " : ""}${lm.text || (lm.hasAttachment ? "Attachment" : "")}`
    : "No messages yet";
  const at = c.updatedAt ?? lm?.createdAt ?? c.createdAt;
  const mine = c.assigneeUid === user.uid;

  return (
    <li>
      <Link
        to={`/conversations/${encodeURIComponent(c.id)}${search}`}
        className={`conversation-row ${selected ? "is-selected" : ""} ${unread > 0 ? "is-unread" : ""}`}
        aria-current={selected ? "page" : undefined}
      >
        <Avatar label={label} />
        <span className="conversation-row__body">
          <span className="conversation-row__top">
            <span className="conversation-row__name">{label}</span>
            <time className="conversation-row__time" dateTime={at ? new Date(at).toISOString() : undefined} title={formatFull(at)}>
              {formatShort(at, now)}
            </time>
          </span>
          <span className="conversation-row__bottom">
            <span className="conversation-row__preview">{preview}</span>
            {unread > 0 && (
              <span className="unread-dot" aria-label={`${unread} unread`}>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
          {c.assigneeUid && (
            <span className="conversation-row__assignee">
              {mine ? "Assigned to you" : `Assigned to ${assigneeName ?? "a teammate"}`}
            </span>
          )}
          {(priority || stage) && (
            <span className="conversation-row__triage">
              {priority && (
                <span className="triage-chip">
                  <span className="select__dot" style={{ background: priority.color }} aria-hidden="true" />
                  {priority.name} priority
                </span>
              )}
              {stage && (
                <span className="triage-chip">
                  <span className="select__dot" style={{ background: stage.color }} aria-hidden="true" />
                  {stage.name}
                </span>
              )}
            </span>
          )}
          {rowTags.length > 0 && <TagChips tags={rowTags} max={3} />}
        </span>
      </Link>
    </li>
  );
}

export function NoConversationSelected() {
  return (
    <div className="center-fill">
      <EmptyState title="Select a conversation">Choose a conversation from the list to read and reply.</EmptyState>
    </div>
  );
}
