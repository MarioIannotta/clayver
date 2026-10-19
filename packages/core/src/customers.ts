/**
 * Customer profiles (`users/{customerId}`), read-only for agents, the
 * customer's conversations, and the admin export/delete callables.
 */
import { equalTo, onValue, orderByChild, query, ref } from "firebase/database";
import { httpsCallable } from "firebase/functions";
import type { ClayverClient } from "./client.js";
import { toClayverError, type ClayverError } from "./errors.js";
import { snapshotToConversations } from "./conversations.js";
import { USER_PROPERTY_KEYS, UserProperty } from "./paths.js";
import {
  CALLABLES,
  type Conversation,
  type ConversationRecord,
  type Customer,
  type CustomerExport,
  type CustomerPropertyValue,
  type CustomerRecord,
  type CustomerRequest,
  type DeleteCustomerResponse,
  type Unsubscribe,
} from "./types.js";

export function subscribeCustomer(
  client: ClayverClient,
  customerId: string,
  callback: (customer: Customer | null) => void,
  onError?: (err: ClayverError) => void,
): Unsubscribe {
  return onValue(
    ref(client.db, client.paths.user(customerId)),
    (snap) => {
      const value = snap.val() as CustomerRecord | null;
      callback(value ? { id: customerId, ...value } : null);
    },
    (err) => onError?.(toClayverError(err)),
  );
}

type CustomerLike = Partial<Pick<CustomerRecord, "properties" | "account">> | null | undefined;

function stringProperty(customer: CustomerLike, key: string): string | undefined {
  const value = customer?.properties?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The customer's name: the `UserProperty.name` property, when set. */
export function customerName(customer: CustomerLike): string | undefined {
  return stringProperty(customer, UserProperty.name);
}

/** The `UserProperty.email` property, else the Firebase Auth account's email. */
export function customerEmail(customer: CustomerLike): string | undefined {
  return stringProperty(customer, UserProperty.email) ?? (customer?.account?.email?.trim() || undefined);
}

/** The `UserProperty.uid` property: the host app's own id for the user. */
export function customerUserId(customer: CustomerLike): string | undefined {
  return stringProperty(customer, UserProperty.uid);
}

/**
 * A short label for a customer: their name, the account's name, their email,
 * else a shortened id.
 */
export function customerLabel(customer: CustomerLike, customerId: string): string {
  return (
    customerName(customer) ??
    (customer?.account?.displayName?.trim() || undefined) ??
    customerEmail(customer) ??
    `Visitor ${customerId.replace(/^v_/, "").slice(0, 6)}`
  );
}

/** Properties other than the `UserProperty` ones, sorted by key. */
export function otherProperties(
  customer: Pick<CustomerRecord, "properties"> | null | undefined,
): [string, CustomerPropertyValue][] {
  const props = customer?.properties ?? {};
  return Object.entries(props)
    .filter(([k]) => !USER_PROPERTY_KEYS.includes(k))
    .sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Live list of every conversation of one customer (open and closed), newest
 * activity first: `orderByChild('customerId').equalTo(customerId)`.
 */
export function subscribeCustomerConversations(
  client: ClayverClient,
  customerId: string,
  callback: (conversations: Conversation[]) => void,
  onError?: (err: ClayverError) => void,
): Unsubscribe {
  return onValue(
    query(ref(client.db, client.paths.conversations()), orderByChild("customerId"), equalTo(customerId)),
    (snap) => callback(snapshotToConversations(snap.val() as Record<string, ConversationRecord> | null)),
    (err) => onError?.(toClayverError(err)),
  );
}

/** Calls `clayverExportCustomer` (admins): everything stored about the customer, as JSON. */
export async function exportCustomer(client: ClayverClient, customerId: string): Promise<CustomerExport> {
  try {
    const fn = httpsCallable<CustomerRequest, CustomerExport>(client.functions, CALLABLES.exportCustomer);
    const { data } = await fn({ projectId: client.projectId, customerId });
    return data;
  } catch (err) {
    throw toClayverError(err);
  }
}

/**
 * Calls `clayverDeleteCustomer` (admins): erases the customer's profile, every
 * conversation they own with its messages, notes and tags, and their files.
 */
export async function deleteCustomer(client: ClayverClient, customerId: string): Promise<void> {
  try {
    const fn = httpsCallable<CustomerRequest, DeleteCustomerResponse>(client.functions, CALLABLES.deleteCustomer);
    await fn({ projectId: client.projectId, customerId });
  } catch (err) {
    throw toClayverError(err);
  }
}

/** File name for a downloaded export: `clayver-customer-{id}-{yyyy-mm-dd}.json`. */
export function customerExportFileName(customerId: string, at = new Date()): string {
  const safe = customerId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return `clayver-customer-${safe}-${at.toISOString().slice(0, 10)}.json`;
}
