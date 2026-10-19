import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  subscribeAgentSettings,
  subscribeAgents,
  subscribeConversation,
  subscribeConversations,
  subscribeConversationsByTag,
  subscribeConversationTags,
  subscribeCustomer,
  subscribeCustomerConversations,
  subscribeMessages,
  subscribeModeration,
  subscribeNotes,
  subscribePrivateConfig,
  subscribeReadMarkers,
  subscribeSavedReplies,
  subscribeTags,
  subscribeTriage,
  type Agent,
  type AgentSettings,
  type ClayverError,
  type Conversation,
  type ConversationListState,
  type ConversationStatus,
  type Customer,
  type MessagesState,
  type ModerationRecord,
  type Note,
  type PrivateConfig,
  type ReadMarkers,
  type SavedReply,
  type Tag,
  type ConversationTriage,
} from "@clayver/core";
import { useClient } from "../clayver";

export interface Loadable<T> {
  data: T;
  loading: boolean;
  error: ClayverError | null;
}

/**
 * Generic adapter for `subscribeX(client, ..., onValue, onError)` functions.
 * `key` identifies the subscription; a change resubscribes.
 */
export function useValueSubscription<T>(
  key: string | null,
  initial: T,
  subscribe: (onValue: (v: T) => void, onError: (e: ClayverError) => void) => () => void,
): Loadable<T> {
  const [state, setState] = useState<Loadable<T> & { key: string | null }>({
    key,
    data: initial,
    loading: key !== null,
    error: null,
  });
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;

  useEffect(() => {
    if (key === null) {
      setState({ key, data: initial, loading: false, error: null });
      return;
    }
    setState({ key, data: initial, loading: true, error: null });
    return subscribeRef.current(
      (data) => setState({ key, data, loading: false, error: null }),
      (error) => setState((s) => ({ ...s, key, loading: false, error })),
    );
    // `initial` is intentionally excluded: callers pass a module-level constant.
  }, [key]);

  // Avoid flashing stale data from the previous key.
  if (state.key !== key) return { data: initial, loading: key !== null, error: null };
  return state;
}

/** The inbox list for one status, optionally only conversations with `tagId` (via `tagIndex`). */
export function useConversationList(status: ConversationStatus, tagId: string | null = null, pageSize = 30) {
  const client = useClient();
  const [state, setState] = useState<ConversationListState>({
    conversations: [],
    loading: true,
    hasMore: false,
    error: null,
  });
  const subRef = useRef<{ loadMore(): void } | null>(null);

  useEffect(() => {
    setState({ conversations: [], loading: true, hasMore: false, error: null });
    const sub = tagId
      ? subscribeConversationsByTag(client, { status, tagId, pageSize }, setState)
      : subscribeConversations(client, { status, pageSize }, setState);
    subRef.current = sub;
    return () => {
      sub.unsubscribe();
      subRef.current = null;
    };
  }, [client, status, tagId, pageSize]);

  const loadMore = useCallback(() => subRef.current?.loadMore(), []);
  return { ...state, loadMore };
}

const NULL_CONVERSATION: Conversation | null = null;
export function useConversation(conversationId: string | undefined) {
  const client = useClient();
  return useValueSubscription<Conversation | null>(conversationId ?? null, NULL_CONVERSATION, (onValue, onError) =>
    subscribeConversation(client, conversationId!, onValue, onError),
  );
}

export function useMessages(conversationId: string | undefined) {
  const client = useClient();
  const [state, setState] = useState<MessagesState & { id?: string }>({
    messages: [],
    loading: true,
    loadingOlder: false,
    hasMore: false,
    error: null,
  });
  const subRef = useRef<{ loadOlder(): Promise<void> } | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    const sub = subscribeMessages(client, conversationId, (s) => setState({ ...s, id: conversationId }));
    subRef.current = sub;
    return () => {
      sub.unsubscribe();
      subRef.current = null;
    };
  }, [client, conversationId]);

  const loadOlder = useCallback(() => subRef.current?.loadOlder() ?? Promise.resolve(), []);
  const current: MessagesState =
    state.id === conversationId
      ? state
      : { messages: [], loading: true, loadingOlder: false, hasMore: false, error: null };
  return { ...current, loadOlder };
}

const EMPTY_READS: ReadMarkers = {};
export function useReadMarkers(conversationId: string | undefined) {
  const client = useClient();
  return useValueSubscription<ReadMarkers>(conversationId ?? null, EMPTY_READS, (onValue, onError) =>
    subscribeReadMarkers(client, conversationId!, onValue, onError),
  );
}

const NULL_CUSTOMER: Customer | null = null;
export function useCustomer(customerId: string | undefined) {
  const client = useClient();
  return useValueSubscription<Customer | null>(customerId ?? null, NULL_CUSTOMER, (onValue, onError) =>
    subscribeCustomer(client, customerId!, onValue, onError),
  );
}

const NO_AGENTS: Agent[] = [];
export function useAgents() {
  const client = useClient();
  const result = useValueSubscription<Agent[]>("agents", NO_AGENTS, (onValue, onError) =>
    subscribeAgents(client, onValue, onError),
  );
  const byUid = useMemo(() => new Map(result.data.map((a) => [a.uid, a])), [result.data]);
  return { ...result, byUid };
}

const NO_TAGS: Tag[] = [];
/** The workspace tag catalog, sorted by name, with a lookup by id. */
export function useTags() {
  const client = useClient();
  const result = useValueSubscription<Tag[]>("tags", NO_TAGS, (onValue, onError) => subscribeTags(client, onValue, onError));
  const byId = useMemo(() => new Map(result.data.map((t) => [t.id, t])), [result.data]);
  return { ...result, byId };
}

const NO_TRIAGE: Record<string, ConversationTriage> = {};
/** Priority and stage of every conversation, keyed by conversation id. */
export function useTriage() {
  const client = useClient();
  return useValueSubscription<Record<string, ConversationTriage>>("triage", NO_TRIAGE, (onValue, onError) =>
    subscribeTriage(client, onValue, onError),
  );
}

const NO_TAG_IDS: string[] = [];
export function useConversationTags(conversationId: string | undefined) {
  const client = useClient();
  return useValueSubscription<string[]>(conversationId ?? null, NO_TAG_IDS, (onValue, onError) =>
    subscribeConversationTags(client, conversationId!, onValue, onError),
  );
}

const NO_NOTES: Note[] = [];
export function useNotes(conversationId: string | undefined) {
  const client = useClient();
  return useValueSubscription<Note[]>(conversationId ?? null, NO_NOTES, (onValue, onError) =>
    subscribeNotes(client, conversationId!, onValue, onError),
  );
}

const NO_REPLIES: SavedReply[] = [];
export function useSavedReplies() {
  const client = useClient();
  return useValueSubscription<SavedReply[]>("savedReplies", NO_REPLIES, (onValue, onError) =>
    subscribeSavedReplies(client, onValue, onError),
  );
}

const NO_BLOCK: ModerationRecord | null = null;
export function useModeration(customerId: string | undefined) {
  const client = useClient();
  return useValueSubscription<ModerationRecord | null>(customerId ?? null, NO_BLOCK, (onValue, onError) =>
    subscribeModeration(client, customerId!, onValue, onError),
  );
}

const NO_CONVERSATIONS: Conversation[] = [];
/** Every conversation of one customer, newest activity first. */
export function useCustomerConversations(customerId: string | undefined) {
  const client = useClient();
  return useValueSubscription<Conversation[]>(customerId ?? null, NO_CONVERSATIONS, (onValue, onError) =>
    subscribeCustomerConversations(client, customerId!, onValue, onError),
  );
}

const EMPTY_PRIVATE_CONFIG: PrivateConfig = {};
export function usePrivateConfig() {
  const client = useClient();
  return useValueSubscription<PrivateConfig>("config/private", EMPTY_PRIVATE_CONFIG, (onValue, onError) =>
    subscribePrivateConfig(client, onValue, onError),
  );
}

const EMPTY_SETTINGS: AgentSettings = {};
export function useAgentSettings(uid: string | undefined) {
  const client = useClient();
  return useValueSubscription<AgentSettings>(uid ?? null, EMPTY_SETTINGS, (onValue, onError) =>
    subscribeAgentSettings(client, uid!, onValue, onError),
  );
}

/** True while the page is visible (for read markers). */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    window.addEventListener("focus", onChange);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, []);
  return visible;
}

/** Re-renders periodically so relative timestamps stay fresh. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
