# Architecture

Clayver has no backend of its own. Everything runs in the developer's Firebase project.

```
 Mobile app (customer)                  Web dashboard (agents)
 ┌───────────────────────┐              ┌──────────────────────────┐
 │ ClayverSDK (Swift)    │              │ @clayver/dashboard (React)│
 │ clayver-android (Kt)  │              │   └ @clayver/core (TS)    │
 │ clayver (Flutter) ────┼─ delegates ─▶│                          │
 └──────────┬────────────┘   to native  └────────────┬─────────────┘
            │  Firebase Auth (host app's users, anonymous, agents)
            │  Realtime Database  ◀── security rules ──▶  Storage
            ▼                                              ▼
 ┌───────────────────────────────────────────────────────────────┐
 │ Developer's Firebase project                                  │
 │  clayver/projects/{workspace}/…   (database.rules.json)       │
 │  clayver/projects/{workspace}/customers/… (storage.rules)     │
 │  Cloud Functions (codebase "clayver")                         │
 │   ├ clayverBootstrapAdmin    first admin                      │
 │   ├ clayverSetAgentRole      grant / revoke / invite          │
 │   ├ onMessageCreated         lastMessage, unread, inbox, FCM  │
 │   ├ onConversation*          inbox, statusOrder, welcome msg  │
 │   ├ onReadMarkerWritten      unread counters                  │
 │   ├ onDeviceWritten          token index, de-duplication      │
 │   └ pruneStaleDevices        daily cleanup                    │
 │  Firebase Cloud Messaging ──▶ APNs / Android / Web push       │
 └───────────────────────────────────────────────────────────────┘
```

## Design decisions

- **Clients write messages directly; rules are the server-side check.**
  Writes go straight to the Realtime Database, so delivery is real time and works
  with the offline cache. The security rules validate every write against the
  caller's authenticated identity and role. `senderType` is checked, never trusted.
  Functions then re-check the sender before fanning out notifications.
- **Privileged operations go through callable functions.** These are role
  changes and data deletion. No client can write roles, claims, counters or indexes.
- **Identity is Firebase Auth.** Customers are the host app's Firebase users
  (anonymous until they log in), and the customer id is their uid. Agents are
  Firebase accounts with an active `agents/{uid}` record and the `clayver_roles`
  claim. No shared secret or extra backend is involved.
- **Counters are recomputed, not incremented.** Unread counts are derived from
  the messages and the read markers inside a guarded transaction. Retried
  (at-least-once) or concurrent function runs therefore converge on the right value.
- **One namespace.** All data lives under `clayver/`, so Clayver can share a
  database with the host app. The setup CLI merges its rules into an existing rules file.
- **Workspaces** (`clayver/projects/{projectId}`) are the multi-tenancy boundary
  for agents, conversations and configuration. Most apps use `default`.
- **Open core.** `packages/core` holds the typed data model and data access.
  The open-source dashboard is a thin React app on top of it, so a future
  advanced dashboard can reuse the same core.
- **Native first.** iOS and Android SDKs are the implementations. The Flutter
  plugin is a Pigeon bridge with no messaging logic of its own.

## Extending later

The data model leaves room for features that are out of scope for the MVP,
without schema breaks:
- more conversation statuses, through the `statusOrder` prefix;
- team routing, through `config/private/notifyAgents` and `assigneeUid`;
- automation or AI replies, as Functions that post `senderType: "system"`
  messages.

See [`firebase/database.schema.md`](../firebase/database.schema.md) for every path.
