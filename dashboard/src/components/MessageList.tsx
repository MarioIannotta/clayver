import { Fragment, useLayoutEffect, useMemo, useRef } from "react";
import {
  buildTimeline,
  isSeenByCustomer,
  type Message,
  type ReadMarkers,
} from "@clayver/core";
import { formatDay, formatFull, formatTime } from "../lib/format";
import { AttachmentView } from "./AttachmentView";
import { EmptyState, ErrorBanner, Spinner } from "./ui";

// Internal notes live in the side panel, not in the message timeline.
const NO_NOTES: never[] = [];

interface Props {
  conversationId: string;
  messages: Message[];
  loading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  error: { message: string } | null;
  reads: ReadMarkers;
  customerLabel: string;
  onLoadOlder: () => void;
}

export function MessageList({
  messages,
  loading,
  loadingOlder,
  hasMore,
  error,
  reads,
  customerLabel,
  onLoadOlder,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const prev = useRef<{ firstId?: string; lastId?: string; scrollHeight: number; nearBottom: boolean }>({
    scrollHeight: 0,
    nearBottom: true,
  });

  const timeline = useMemo(() => buildTimeline(messages, NO_NOTES, hasMore), [messages, hasMore]);
  const itemKey = (i: (typeof timeline)[number] | undefined) =>
    i ? (i.kind === "note" ? `note:${i.note.id}` : i.message.id) : undefined;

  // Keep the view anchored: stick to the bottom for new messages and notes,
  // and keep the visible message in place when an older page is prepended.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const firstId = itemKey(timeline[0]);
    const lastId = itemKey(timeline[timeline.length - 1]);
    const p = prev.current;
    if (p.firstId && firstId !== p.firstId && lastId === p.lastId) {
      el.scrollTop += el.scrollHeight - p.scrollHeight;
    } else if (lastId !== p.lastId && (p.nearBottom || !p.lastId)) {
      el.scrollTop = el.scrollHeight;
    }
    prev.current = { firstId, lastId, scrollHeight: el.scrollHeight, nearBottom: isNearBottom(el) };
  }, [timeline]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    prev.current.nearBottom = isNearBottom(el);
    prev.current.scrollHeight = el.scrollHeight;
  };

  // The newest agent message the customer has seen gets the "Seen" receipt.
  const seenId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.senderType === "agent" && isSeenByCustomer(reads, m.createdAt)) return m.id;
    }
    return undefined;
  }, [messages, reads]);
  const lastAgentId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.senderType === "agent") return messages[i]!.id;
    return undefined;
  }, [messages]);

  return (
    <div className="messages" ref={scroller} onScroll={onScroll}>
      <ErrorBanner error={error} />
      {hasMore && (
        <div className="center-pad">
          <button type="button" className="btn btn--small" onClick={onLoadOlder} disabled={loadingOlder}>
            {loadingOlder ? "Loading…" : "Load earlier messages"}
          </button>
        </div>
      )}
      {loading ? (
        <div className="center-pad">
          <Spinner label="Loading messages" />
        </div>
      ) : timeline.length === 0 && !error ? (
        <EmptyState title="No messages yet" />
      ) : (
        <ol className="messages__list" aria-label="Messages" aria-live="polite" aria-relevant="additions">
          {timeline.map((item, i) => {
            const prevItem = timeline[i - 1];
            const showDay = !prevItem || new Date(prevItem.at).toDateString() !== new Date(item.at).toDateString();
            return (
              <Fragment key={itemKey(item)}>
                {showDay && (
                  <li className="day-separator" aria-hidden="false">
                    <span>{formatDay(item.at)}</span>
                  </li>
                )}
                {item.kind === "note" ? null : (
                  <MessageBubble
                    message={item.message}
                    customerLabel={customerLabel}
                    receipt={
                      item.message.id === seenId ? "Seen" : item.message.id === lastAgentId && !seenId ? "Sent" : undefined
                    }
                  />
                )}
              </Fragment>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function MessageBubble({
  message: m,
  customerLabel,
  receipt,
}: {
  message: Message;
  customerLabel: string;
  receipt?: string;
}) {
  if (m.senderType === "system") {
    return (
      <li className="message message--system">
        <span>{m.text}</span>
      </li>
    );
  }
  const fromAgent = m.senderType === "agent";
  const author = fromAgent ? m.senderName || "Agent" : customerLabel;
  return (
    <li className={`message ${fromAgent ? "message--agent" : "message--customer"}`}>
      <div className="message__meta">
        <span className="message__author">{author}</span>
        <time dateTime={new Date(m.createdAt).toISOString()} title={formatFull(m.createdAt)}>
          {formatTime(m.createdAt)}
        </time>
      </div>
      <div className="message__bubble">
        {m.attachment && <AttachmentView attachment={m.attachment} />}
        {m.text && <p className="message__text">{m.text}</p>}
      </div>
      {receipt && (
        <div className={`message__receipt ${receipt === "Seen" ? "is-seen" : ""}`}>{receipt}</div>
      )}
    </li>
  );
}
