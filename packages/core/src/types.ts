/**
 * Typed data model for the Clayver Realtime Database layout.
 * Mirrors firebase/database.schema.md; keep both in sync.
 */

/** Server timestamp in milliseconds since the epoch. */
export type Timestamp = number;

export type ConversationStatus = "open" | "closed";
export const CONVERSATION_STATUSES: readonly ConversationStatus[] = ["open", "closed"] as const;

/** Id of an option in `triageOptions/priority` (defaults: `high`, `medium`, `low`). */
export type ConversationPriority = string;

/** Id of an option in `triageOptions/stage` (defaults: `todo`, `in_progress`, `on_hold`). */
export type ConversationStage = string;

/** Which list a triage option belongs to. */
export type TriageKind = "priority" | "stage";

/** `triageOptions/{kind}/{optionId}`: one entry of the workspace's priority or status list. */
export interface TriageOptionRecord {
  name: string;
  /** `#rrggbb`. */
  color: string;
  /** Position in the list, lowest first. */
  order: number;
}

export interface TriageOption extends TriageOptionRecord {
  id: string;
}

export type SenderType = "customer" | "agent" | "system";

export type AgentRole = "admin" | "agent";

/** Role argument accepted by `clayverSetAgentRole`; `"none"` revokes. */
export type AgentRoleChange = AgentRole | "none";


export interface LastMessage {
  text: string;
  senderType: SenderType;
  createdAt: Timestamp;
  hasAttachment: boolean;
}

export interface UnreadCounters {
  customer: number;
  agent: number;
}

/** `conversations/{conversationId}` as stored. */
export interface ConversationRecord {
  customerId: string;
  status: ConversationStatus;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  assigneeUid?: string;
  lastMessage?: LastMessage;
  unread?: UnreadCounters;
  statusOrder?: string;
  closedAt?: Timestamp;
}

/** A conversation record together with its key. */
export interface Conversation extends ConversationRecord {
  id: string;
}

export interface Attachment {
  storagePath: string;
  fileName: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
}

/** `messages/{conversationId}/{messageId}` as stored. */
export interface MessageRecord {
  senderId: string;
  senderType: SenderType;
  senderName?: string;
  text?: string;
  attachment?: Attachment;
  createdAt: Timestamp;
  clientMessageId?: string;
}

export interface Message extends MessageRecord {
  id: string;
}

export interface CustomerReadMarker {
  lastReadAt: Timestamp;
}

export interface AgentReadMarker {
  lastReadAt: Timestamp;
  uid: string;
}

/** `reads/{conversationId}`. */
export interface ReadMarkers {
  customer?: CustomerReadMarker;
  agent?: AgentReadMarker;
}

export type CustomerPropertyValue = string | number | boolean;

/** `users/{customerId}`. */
export interface CustomerRecord {
  properties?: Record<string, CustomerPropertyValue>;
  lastSeenAt?: Timestamp;
  notifications?: { enabled?: boolean };
  /** The customer's Firebase Auth account (written only by Cloud Functions). */
  account?: CustomerAccount;
  createdAt?: Timestamp;
}

/** `users/{customerId}/account`: a snapshot of the customer's Firebase Auth account. */
export interface CustomerAccount {
  /** True for an anonymous visitor (no sign-in provider). */
  anonymous: boolean;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  updatedAt?: Timestamp;
}

export interface Customer extends CustomerRecord {
  id: string;
}

/** `agents/{uid}` (written only by Cloud Functions). */
export interface AgentRecord {
  role: AgentRole;
  active: boolean;
  email?: string | null;
  displayName?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  grantedBy?: string;
}

export interface Agent extends AgentRecord {
  uid: string;
}

/** `agentSettings/{uid}`. */
export interface AgentSettings {
  notifications?: { push?: boolean };
}

export type DevicePlatform = "ios" | "android" | "web";

/** `devices/agents/{uid}/{deviceId}` and `devices/customers/{cid}/{deviceId}`. */
export interface DeviceRegistration {
  uid: string;
  platform: DevicePlatform;
  pushToken: string;
  active: boolean;
  updatedAt: Timestamp;
  appVersion?: string;
  sdkVersion?: string;
  locale?: string;
}

/** `config/public`. */
export interface PublicConfig {
  teamName?: string;
  welcomeMessage?: string;
  accentColor?: string;
}

/** `config/private/rateLimits`: automatic `rate_limit` blocks kick in above these. */
export interface RateLimits {
  messagesPerMinute: number;
  conversationsPerHour: number;
}

/** `config/private`. */
export interface PrivateConfig {
  notifyAgents?: "all" | "assignee_or_all";
  rateLimits?: Partial<RateLimits>;
}

/** `tags/{tagId}`: the workspace tag catalog. `tagId` is the slug of the name at creation. */
export interface TagRecord {
  name: string;
  /** `#rrggbb`. */
  color: string;
  createdAt?: Timestamp;
  /** The uid of the agent who created it. */
  createdBy?: string;
}

export interface Tag extends TagRecord {
  id: string;
}

/** `triage/{conversationId}`: agent-only labels the customer never sees. */
export interface ConversationTriage {
  priority?: ConversationPriority;
  stage?: ConversationStage;
}

/** `notes/{conversationId}/{noteId}`: an internal note, never shown to the customer. */
export interface NoteRecord {
  authorUid: string;
  authorName?: string;
  text: string;
  createdAt: Timestamp;
}

export interface Note extends NoteRecord {
  id: string;
}

/** `savedReplies/{replyId}`: a team-shared canned response. */
export interface SavedReplyRecord {
  title: string;
  text: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SavedReply extends SavedReplyRecord {
  id: string;
}

export type BlockReason = "spam" | "abuse" | "rate_limit" | "other";

/** `moderation/{customerId}`: a block on a customer's writes. */
export interface ModerationRecord {
  blocked: true;
  reason: BlockReason;
  /** The block ends at this time; absent means until an agent removes it. */
  until?: Timestamp;
  /** The agent's uid, or `"system"` for automatic rate-limit blocks. */
  by: string;
  at: Timestamp;
}

/** `data` block of every Clayver push. */
export interface ClayverPushData {
  clayver: "1";
  type: "message";
  projectId: string;
  conversationId: string;
  messageId: string;
  link: string;
}

/* ---- Callable functions ---- */

export interface BootstrapAdminRequest {
  projectId: string;
}
export interface BootstrapAdminResponse {
  role: "admin";
}

/** Exactly one of `email` or `uid`: agents are Firebase Auth accounts. */
export interface SetAgentRoleRequest {
  projectId: string;
  email?: string;
  uid?: string;
  role: AgentRoleChange;
  displayName?: string;
}
export interface SetAgentRoleResponse {
  uid?: string;
  role: AgentRoleChange;
  inviteLink?: string;
}

export interface CustomerRequest {
  projectId: string;
  customerId: string;
}
export interface DeleteCustomerResponse {
  deleted: true;
}
/** `clayverExportCustomer` result: everything stored about one customer. */
export interface CustomerExport {
  exportedAt?: string;
  projectId?: string;
  customer: Record<string, unknown> & { customerId: string };
  conversations: (Record<string, unknown> & {
    id: string;
    tags: string[];
    messages: Record<string, unknown>[];
    notes: Record<string, unknown>[];
  })[];
}

/** `clayverAuthSettings`: omit `anonymous` to read the current setting. */
export interface AuthSettingsRequest {
  projectId: string;
  anonymous?: boolean;
}
export interface AuthSettingsResponse {
  /** Whether Firebase Auth allows anonymous sign-in (project-wide). */
  anonymous: boolean;
}

/** Function names, exactly as deployed. */
export const CALLABLES = {
  bootstrapAdmin: "clayverBootstrapAdmin",
  setAgentRole: "clayverSetAgentRole",
  deleteCustomer: "clayverDeleteCustomer",
  exportCustomer: "clayverExportCustomer",
  authSettings: "clayverAuthSettings",
} as const;

/** Name of the custom claim mirroring roles, used by Storage rules. */
export const ROLES_CLAIM = "clayver_roles";

/** Unsubscribe callback returned by every subscription. */
export type Unsubscribe = () => void;
