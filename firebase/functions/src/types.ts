export type ConversationStatus = "open" | "closed";
export type SenderType = "customer" | "agent" | "system";
export type Role = "admin" | "agent";

export interface LastMessage {
  text: string;
  senderType: SenderType;
  createdAt: number;
  hasAttachment: boolean;
}

export interface UnreadBasis {
  customerReadAt: number;
  agentReadAt: number;
  lastMessageAt: number;
}

export interface Conversation {
  customerId: string;
  status: ConversationStatus;
  createdAt: number;
  updatedAt?: number;
  assigneeUid?: string;
  lastMessage?: LastMessage;
  unread?: { customer: number; agent: number };
  unreadBasis?: UnreadBasis;
  statusOrder?: string;
  closedAt?: number | null;
  rev?: number;
}

export interface Attachment {
  storagePath: string;
  fileName: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
}

export interface Message {
  senderId: string;
  senderType: SenderType;
  senderName?: string;
  text?: string;
  attachment?: Attachment;
  createdAt: number;
  clientMessageId?: string;
}

export interface AgentRecord {
  role: Role;
  active: boolean;
  email?: string | null;
  displayName?: string | null;
  createdAt?: number;
  updatedAt?: number;
  grantedBy?: string;
}

/** Server-written snapshot of the customer's Firebase Auth account (`users/{cid}/account`). */
export interface CustomerAccount {
  anonymous: boolean;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  updatedAt: number;
}

export interface DeviceRegistration {
  uid: string;
  platform: "ios" | "android" | "web";
  pushToken?: string;
  active: boolean;
  updatedAt: number;
  invalidatedAt?: number;
}

export interface InboxEntry {
  status: ConversationStatus;
  createdAt: number;
  updatedAt: number;
  lastMessage: LastMessage | null;
  unread: number;
  rev: number;
}
