# Clayver data model (Realtime Database + Storage)

This document is the contract shared by the Cloud Functions, the security rules,
the native SDKs, the Flutter wrapper and the dashboard. If you change a path or
a field here, change it everywhere.

All Clayver data lives under a single namespace, `clayver/`, so it can sit next
to data the host application already keeps in the same database without the
rules colliding. The setup CLI merges `firebase/database.rules.json` into an
existing rules file instead of replacing it.

## Concepts

| Term | Meaning |
| --- | --- |
| **Firebase project** | The developer's own project. All Clayver data and functions run there. |
| **Clayver project** (`projectId`) | A support workspace inside the Firebase project. One app usually uses one workspace called `default`. Agents, conversations and configuration are scoped to a workspace, which is the multi-tenancy boundary. Key format: `^[a-z0-9-]{1,40}$`. |
| **Customer id** (`customerId`, a.k.a. `cid`) | The identity a customer acts as. See *Customer identity* below. |
| **Agent** | A Firebase Auth user that an admin has explicitly granted the `agent` or `admin` role in a workspace. |

## Customer identity

Every SDK call is made by a Firebase Auth user of the host app's Firebase
project, and **the customer id is that user's uid** (`cid = auth.uid`). It is
never taken from a client-provided field or a custom claim.

- **Signed-in user.** The host app signs users in with Firebase Auth (any
  provider). All devices signed in to the same account act as the same customer.
- **Anonymous visitor.** When the host app has no Firebase user, the SDK signs
  in anonymously (unless `signInAnonymously` is off). Linking a credential to
  that user later (`linkWithCredential`) keeps the uid and its conversations.

In security rules, "the caller is customer `X`" is `auth != null && auth.uid == X`.

## Roles

Roles live in `clayver/projects/{projectId}/agents/{uid}` and are **only**
writable by Cloud Functions (Admin SDK). Rules check
`agents/{auth.uid}/active === true` (and `role === 'admin'` for admin-only
paths), so revocation takes effect on the next database operation.

Because Storage rules cannot read the Realtime Database, the same role is
mirrored into the custom claim `clayver_roles: { [projectId]: "admin" | "agent" }`.
On revocation the claim is removed and the user's refresh tokens are revoked;
an already-issued ID token can still read attachments for up to one hour.

| Role | Can |
| --- | --- |
| `admin` | Everything an agent can, plus grant/revoke roles (via `clayverSetAgentRole`), write `config/`, delete tags, and export or delete a customer's data. |
| `agent` | Read all conversations, customers and messages in the workspace, reply, open/close/assign conversations, mark read, tag conversations and create/edit tags, write internal notes and saved replies, block and unblock customers. |

### Agents inside the mobile app (agent mode)

An agent can also answer from any app that embeds the SDK: the host app signs
the person into Firebase Auth in the same project, and an admin grants a role
to that account (by email or uid), exactly as for the dashboard.

The SDKs decide whether to show agent features from the ID token
(`clayver_roles[projectId]`, read with `getIdTokenResult`). The security rules
remain the authority: they check `agents/{auth.uid}/active` on every read and
write, so a stale or forged claim opens nothing.

The first admin is created by `clayverBootstrapAdmin`, which succeeds only when
the workspace has no admin yet **and** the caller's verified email is listed in
the `CLAYVER_BOOTSTRAP_ADMINS` function parameter. The CLI command
`clayver admin grant` does the same through the Admin SDK with the developer's
own Google credentials.

## Custom claims

| Claim | Type | Set by |
| --- | --- | --- |
| `clayver_roles` | map projectId → `"admin"` / `"agent"` | `clayverSetAgentRole`, `clayverBootstrapAdmin` |

Clients must refresh their ID token (`getIdToken(true)`) to see a change made
while they are signed in. The SDKs and the dashboard do this automatically.

## Realtime Database layout

All paths are relative to `clayver/projects/{projectId}/`.
`(fn)` means written only by Cloud Functions. `ts` means a server timestamp in
milliseconds (`ServerValue.TIMESTAMP`). Rules reject any field not listed.

### `conversations/{conversationId}`

| Field | Type | Writer |
| --- | --- | --- |
| `customerId` | string | customer, on create; must be the caller's cid |
| `status` | `"open"` \| `"closed"` | customer on create (`"open"` only); agents afterwards |
| `createdAt` | ts | customer on create (must equal `now`) |
| `updatedAt` | ts | (fn) |
| `assigneeUid` | string \| absent | agents (must be an active agent's uid) |
| `lastMessage` | `{ text, senderType, createdAt, hasAttachment }` | (fn) |
| `unread` | `{ customer: number, agent: number }` | (fn) |
| `statusOrder` | string `"{status}_{updatedAt zero-padded to 15}"` | (fn), for status-filtered inbox queries |
| `closedAt` | ts | (fn) |

`conversationId` is a push id created by the client.

A customer can have any number of conversations, open or closed. Each one is a
separate thread with its own messages, status, assignee and tags.

Reads: the owning customer, and agents. Agents list conversations with
`orderByChild('statusOrder').startAt('open_').endAt('open_~').limitToLast(n)`.

### `messages/{conversationId}/{messageId}`

| Field | Type | Notes |
| --- | --- | --- |
| `senderId` | string | Customer: the caller's cid. Agent: `auth.uid`. |
| `senderType` | `"customer"` \| `"agent"` \| `"system"` | Validated against the caller's identity and role by rules; `system` is (fn) only. |
| `senderName` | string ≤ 80 | Agents only (display name). |
| `text` | string 1..4000 | Optional when `attachment` is present. |
| `attachment` | `{ storagePath, fileName, contentType, size, width?, height? }` | `storagePath` must start with the conversation's customer storage prefix; `size` ≤ 300 KiB (the SDKs compress photos to fit); `contentType` in the allowlist below. |
| `createdAt` | ts | Must equal `now`. |
| `clientMessageId` | string ≤ 64 | Optional, lets clients reconcile optimistic sends. |

Messages are immutable for clients (create only). `messageId` is a push id, so
`orderByKey()` is chronological. History is paginated with
`orderByKey().limitToLast(30)` then `.endBefore(oldestKey)`.

A customer may write to a closed conversation; the function reopens it.

### `reads/{conversationId}`

| Path | Fields | Writer |
| --- | --- | --- |
| `customer` | `{ lastReadAt: ts }` | the owning customer |
| `agent` | `{ lastReadAt: ts, uid }` | any agent (shared team read marker) |

`lastReadAt` must be ≤ `now`. Writing a read marker makes the function
recompute the unread counters. These markers double as **read receipts**: a
message is "seen" by the other side when its `createdAt <= lastReadAt`.

### `inbox/{customerId}` (fn, read by the customer)

```
inbox/{cid}/
  unreadTotal: number
  conversations/{conversationId}: { status, updatedAt, createdAt, lastMessage, unread }
```

The customer-side index of their conversations. `unreadTotal` is the sum of
`unread` over all conversations, which is what `getUnreadMessagesCount()`
returns.

### `users/{customerId}`

| Field | Writer |
| --- | --- |
| `properties/{key}` | the customer; key `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` or `_name` / `_email` / `_uid` (string values only); value string ≤ 1000, number or boolean |
| `lastSeenAt` | the customer (`now`) |
| `notifications/enabled` | the customer (boolean) |
| `account` | (fn) `{ anonymous, email, emailVerified, displayName, updatedAt }`, a snapshot of the customer's Firebase Auth account, refreshed when they open a conversation |
| `createdAt` | (fn) |

Readable by the customer and by agents. The reserved keys, written through the SDKs'
`UserProperty` constants, are shown specially by the dashboard and the agent
views: `_name` (the customer's name), `_email` (overrides the account email)
and `_uid` (the host app's own user id, shown as "User ID"). Custom keys
can't start with `_`.

### `agents/{uid}` (fn)

`{ role: "admin" | "agent", active: boolean, email, displayName, createdAt, updatedAt, grantedBy }`

Readable by any active agent of the workspace (team list) and by the user
themselves. Written by functions, except `displayName` (1..80 chars), which an
active agent may change for themselves.

### `agentSettings/{uid}`

`{ notifications: { push: boolean } }`, written by that agent.

### `devices/customers/{customerId}/{deviceId}` and `devices/agents/{uid}/{deviceId}`

A device registration. `deviceId` is a random id the SDK generates once per
installation (`^[A-Za-z0-9_-]{8,64}$`).

| Field | Type |
| --- | --- |
| `uid` | the Firebase uid that wrote the registration (must equal `auth.uid`) |
| `platform` | `"ios"` \| `"android"` \| `"web"` |
| `pushToken` | FCM registration token (≤ 4096 chars) |
| `active` | boolean; set `false` by the owner on opt-out and by the function on invalid tokens |
| `updatedAt` | ts (= `now`) |
| `appVersion`, `sdkVersion`, `locale` | optional strings ≤ 64 |

Owners may create, update and delete their own registrations. Token refreshes
overwrite `pushToken` on the same `deviceId`. The function keeps
`tokenIndex/{sha256(ownerType + ":" + pushToken)}` so one token belongs to exactly one
registration per audience (the same phone can hold a customer registration and an agent registration): when a token shows up under a new owner (log out, log in as
someone else on the same phone), the old registration is deleted.

### `tokenIndex/{sha256(ownerType + ":" + pushToken)}` (fn, no client access)

`{ ownerType: "customer" | "agent", ownerId, deviceId }`

### `moderation/{customerId}`

Blocks a customer from writing. While a block is active the rules reject the
customer's new conversations and messages; reads still work, so the customer
keeps their history.

| Field | Type |
| --- | --- |
| `blocked` | `true` |
| `reason` | `"spam"` \| `"abuse"` \| `"rate_limit"` \| `"other"` |
| `until` | ts, optional. The block ends at this time; absent means until an agent removes it. |
| `by` | the agent's uid, or `"system"` for automatic rate-limit blocks |
| `at` | ts (= `now`) |

A block is active when `blocked === true && (until == null || until > now)`.
Agents create and delete blocks (`by` must equal `auth.uid`, and `reason` can't be
`rate_limit`, which only the functions write); unblocking is a delete. Readable by agents and by that customer, so the SDK can show
"You can't send messages right now".

**Automatic rate limits.** Functions count each customer's activity in
`limits/{customerId}` (server-only). Over `messagesPerMinute` (default 30) or
`conversationsPerHour` (default 10), the function writes a `rate_limit` block for
10 minutes or 1 hour, never replacing a manual block. Admins change the limits in
`config/private/rateLimits`.

### `tags/{tagId}` (workspace tag catalog)

| Field | Type | Writer |
| --- | --- | --- |
| `name` | string, 1-40 chars | agents |
| `color` | `#rrggbb` | agents |
| `createdAt` | ts (= `now` on create, immutable) | agents |
| `createdBy` | uid (= `auth.uid` on create, immutable) or `"system"` | agents |

Readable by agents. Any agent creates and edits tags; only admins delete them.
`tagId` is the **slug of the name** at creation time, so the same name can't be
created twice: lowercase, strip diacritics (NFKD, drop combining marks), replace
every run of characters outside `[a-z0-9]` with `-`, trim `-`, cut to 40
characters, then trim a trailing `-` again (`^[a-z0-9][a-z0-9-]{0,39}$`). Letters
with no decomposition (`ß`, `ø`) become separators: "Straße" is `stra-e`. A name with no usable characters (for
example only emoji) gets `tag-` plus 8 random `[a-z0-9]`. Renaming keeps the id.
Creating a tag whose slug exists returns the existing tag instead.

Deleting a tag removes it from every conversation (function).

There are no default tags: agents create the ones they need. Priority and
workflow status are not tags; they live in `triage/` below.

**Color palette** for new tags (clients offer these; the default is chosen by
the slug: sum of the slug's UTF-16 code units modulo 10):
`#2563EB #7C3AED #D97706 #64748B #DC2626 #EA580C #0D9488 #16A34A #0891B2 #DB2777`.

### `conversationTags/{conversationId}/{tagId}`

`true` when the conversation has the tag. Agents only: customers never see tags.
Agents add a tag only if `tags/{tagId}` exists and the conversation exists; any
agent removes one.

### `triage/{conversationId}` (agents only)

| Field | Type | Notes |
| --- | --- | --- |
| `priority` | option id | Optional. An id in `triageOptions/priority`. |
| `stage` | option id | Optional; shown as "Status" in the dashboard. An id in `triageOptions/stage`. |

Any agent sets or clears these, only for an existing conversation. Kept out of
`conversations/`, which the customer can read, so customers never see them.

### `triageOptions/{priority|stage}/{optionId}` (agents only)

`{ name: string 1..40, color: "#rrggbb", order: number }`: the workspace's
priority and status lists, edited by any agent in the dashboard's Settings.
`optionId` matches `^[a-z0-9][a-z0-9_-]{0,39}$`. While a list has never been
saved the defaults apply, and only their ids are accepted in `triage/`:

| List | Defaults (id: name) |
| --- | --- |
| `priority` | `high`: High, `medium`: Medium, `low`: Low |
| `stage` | `todo`: To do, `in_progress`: In progress, `on_hold`: On hold |

A value whose option was removed stays stored but shows as unset.

### `tagIndex/{tagId}/{conversationId}` (fn, read by agents)

The conversation's current `statusOrder`, kept in step by the functions, so an
inbox filtered by tag is a single query:
`tagIndex/{tagId}.orderByValue().startAt('open_').endAt('open_~').limitToLast(n)`,
then read each `conversations/{conversationId}`.

### `notes/{conversationId}/{noteId}` (internal notes)

| Field | Type |
| --- | --- |
| `authorUid` | `auth.uid` |
| `authorName` | string 1-80, optional |
| `text` | string 1-4000 |
| `createdAt` | ts (= `now`) |

Agent-only notes on a conversation, never shown to the customer and never
pushed. Immutable; the author or an admin can delete one.

### `savedReplies/{replyId}`

| Field | Type |
| --- | --- |
| `title` | string 1-80 |
| `text` | string 1-4000 |
| `createdBy` | uid (= `auth.uid` on create, immutable) |
| `createdAt` | ts (= `now` on create, immutable) |
| `updatedAt` | ts (= `now`) |

Team-shared canned responses. Any agent creates and edits; the creator or an
admin deletes. `replyId` is a push id.

### `limits/{customerId}` and `meta` (fn, no client access)

Rate-limit counters and per-workspace markers.

### `config/public` and `config/private`

| Path | Readable by | Writable by |
| --- | --- | --- |
| `config/public` `{ teamName?, welcomeMessage?, accentColor? }` | any signed-in user | admins |
| `config/private` `{ notifyAgents?: "all" \| "assignee_or_all", rateLimits?: { messagesPerMinute: 1-1000, conversationsPerHour: 1-1000 } }` | agents | admins |

### `notificationLog/{messageId}` (fn, no client access)

Idempotency marker so a retried function invocation does not push twice.

## Storage layout

```
clayver/projects/{projectId}/customers/{customerId}/conversations/{conversationId}/{attachmentId}/{fileName}
```

- Read: the customer `customerId`, or an agent of `projectId` (via the `clayver_roles` claim).
- Create: same principals, `size <= 300 KiB`, `contentType` in the allowlist, `fileName` ≤ 200 chars.
- Update/delete: nobody (attachments are immutable; deleting is an admin task).

**Content type allowlist** (photos only): `image/jpeg`, `image/png`, `image/gif`,
`image/webp`, `image/heic`. The SDKs and the dashboard re-encode every photo as a
JPEG of at most 300 KiB before uploading.

## Push notification payload

Every Clayver push is an FCM message with a notification (`title`, `body`) and
this `data` block, which the SDKs use to recognise and deep-link Clayver pushes:

```json
{
  "clayver": "1",
  "type": "message",
  "audience": "customer",
  "projectId": "default",
  "conversationId": "-Nx...",
  "messageId": "-Ny...",
  "link": "clayver://conversation/-Nx..."
}
```

`audience` is `"customer"` for pushes to a customer's devices and `"agent"` for
pushes to agent devices. SDKs open the customer chat for `customer` and the agent
conversation view for `agent`.

The dashboard receives the same payload as a web push and opens
`/conversations/{conversationId}`.

## Callable Cloud Functions

All callables take `projectId` and run in the region the developer deploys to
(`us-central1` by default; the SDKs expose a `functionsRegion` option).

| Function | Input | Output | Who |
| --- | --- | --- | --- |
| `clayverBootstrapAdmin` | `{ projectId }` | `{ role: "admin" }` | first admin, see *Roles* |
| `clayverSetAgentRole` | `{ projectId, email? , uid?, role: "admin" \| "agent" \| "none", displayName? }` | `{ uid, role, inviteLink? }` | admins. Exactly one of `email`, `uid`. |
| `clayverDeleteMyData` | `{ projectId }` | `{ deleted: true }` | the signed-in customer, for their own customer id |
| `clayverDeleteCustomer` | `{ projectId, customerId }` | `{ deleted: true }` | admins |
| `clayverExportCustomer` | `{ projectId, customerId }` | `{ customer, conversations: [{ id, ...conversation, priority?, stage?, tags, messages, notes }] }` (JSON) | admins |
| `clayverAuthSettings` | `{ projectId, anonymous? }` | `{ anonymous }` | admins. Reads, or with `anonymous` sets, Firebase Auth anonymous sign-in (project-wide). |

**Deleting a customer** removes their `users`, `inbox`, `moderation`, `limits`,
`devices/customers` registrations (and their `tokenIndex` entries), every
conversation they own with its `messages`, `reads`, `conversationTags`,
`tagIndex` entries, `notes` and `triage`, their Storage folder
`customers/{customerId}/`. Push idempotency markers hold no
personal data and expire on their own.

Errors use the standard callable codes: `unauthenticated`,
`permission-denied`, `invalid-argument`, `failed-precondition`, `not-found`.

## Background functions

| Trigger | Does |
| --- | --- |
| message created | Applies the message rate limit to customers. Re-validates the sender against the role table, updates `lastMessage`/`updatedAt`/`statusOrder`, reopens closed conversations, recomputes unread counters, updates `inbox`, sends push notifications. |
| conversation created | Creates the `inbox` entry, posts the workspace welcome message if any, and applies the conversation rate limit. |
| conversation status/assignee changed | Syncs `statusOrder`, `closedAt` and the `inbox` entry. |
| conversation tag written | Keeps `tagIndex` in step. Every change to `statusOrder` also refreshes the conversation's `tagIndex` entries. |
| tag deleted | Removes the tag from every conversation and drops `tagIndex/{tagId}`. |
| read marker written | Recomputes the unread counters and `inbox/{cid}/unreadTotal`. |
| device registration written | Maintains `tokenIndex` and removes duplicate registrations of the same token. |
| daily schedule | Deletes registrations not updated for 270 days and expired `rate_limit` blocks. |

Unread counters are recomputed, not incremented: `unread.customer` is the number
of agent/system messages with `createdAt > reads/customer/lastReadAt`. The write
is a transaction guarded by the newest message time it accounted for, so
concurrent invocations can never move the counter backwards.
