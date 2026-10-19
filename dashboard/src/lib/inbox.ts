import type { ConversationPriority, ConversationStage, ConversationStatus } from "@clayver/core";

/** Inbox filters kept in the URL query: `?status=closed&tag=bug&priority=high&stage=todo`. */
export interface InboxFilters {
  status: ConversationStatus;
  tag: string | null;
  priority: ConversationPriority | null;
  stage: ConversationStage | null;
}

const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function readInboxFilters(params: URLSearchParams): InboxFilters {
  const priority = params.get("priority");
  const stage = params.get("stage");
  return {
    status: params.get("status") === "closed" ? "closed" : "open",
    tag: params.get("tag") || null,
    priority: priority && ID.test(priority) ? priority : null,
    stage: stage && ID.test(stage) ? stage : null,
  };
}

/** The query string for `filters` ("" for the default open, unfiltered inbox). */
export function inboxSearch(filters: InboxFilters): string {
  const out = new URLSearchParams();
  if (filters.status !== "open") out.set("status", filters.status);
  if (filters.tag) out.set("tag", filters.tag);
  if (filters.priority) out.set("priority", filters.priority);
  if (filters.stage) out.set("stage", filters.stage);
  const s = out.toString();
  return s ? `?${s}` : "";
}
