# Security model

Security is enforced by Firebase Security Rules (database and storage) and by
Cloud Functions running with admin privileges. Nothing in the mobile apps or
the dashboard is trusted.

## Identities

| Who | How they authenticate | What identifies them in rules |
| --- | --- | --- |
| Customer, signed in | The host app's own Firebase Auth user (any provider) | `auth.uid` |
| Customer, anonymous visitor | Anonymous Firebase user (unless `signInAnonymously` is off) | `auth.uid` |
| Agent / admin | Firebase Auth account in the same project | `auth.uid` + an active record in `agents/` (database), `clayver_roles` claim (Storage) |

**Impersonation.** The customer id is always the caller's Firebase uid, so a
customer can only reach their own data, and proving who they are is Firebase
Auth's job. There is no Clayver secret to leak. Custom claims other than
`clayver_roles` are ignored. See [identity.md](identity.md).

**Agents.** A valid Firebase account is not an agent. Agent and admin roles
exist only in `clayver/projects/{p}/agents/{uid}`, which no client can write.
Roles change only through:
- `clayverBootstrapAdmin`: only when the workspace has no admin, and only for a
  verified email listed in `CLAYVER_BOOTSTRAP_ADMINS`;
- `clayverSetAgentRole`: admins only, and the last admin cannot be removed;
- `clayver admin grant`: the developer's own Google credentials via the Admin SDK.

Revocation takes effect on the next database operation. Storage reads rely on
the `clayver_roles` claim, which is removed on revoke, and refresh tokens are
revoked too. An already-issued ID token keeps Storage read access for at most
one hour.

## What the rules enforce

- Default deny at the root. Clayver only opens paths under `clayver/`.
- Customers read only their own conversations, messages, read markers, inbox,
  profile and devices. They cannot list `conversations/`.
- A message's `senderType` must match the caller:
  - `customer` requires the caller to own the conversation, with `senderId` set to their customer id;
  - `agent` requires an active agent, with `senderId` set to their uid;
  - `system` is server-only.
- Messages are immutable, `createdAt` must be the server time, and text is limited to 4000 characters.
- Attachments must point into the conversation owner's storage folder, must be
  300 KiB or smaller, and must be a photo (JPEG, PNG, GIF, WebP or HEIC). Storage rules
  enforce the same limits on the file itself and make files immutable.
- Customer properties: keys `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`, or the reserved `_name`, `_email` and `_uid` (strings only); values are strings (up to 1000 characters), numbers or booleans.
- Server-maintained fields (`lastMessage`, `unread`, `statusOrder`, `inbox`,
  `account`, `tokenIndex`, `notificationLog`) are read-only for clients.
- Device registrations: owners only, `uid` must equal the caller, the platform is
  validated, and `updatedAt` must be the server time.
- Read markers only move forward and never into the future.
- Workspaces are isolated: an agent of `default` has no access to `other`.

All of this is covered by the emulator tests in `firebase/tests`.

## No secrets in clients

The mobile SDKs and the dashboard only use the public Firebase config. Clayver
has no secret of its own for identity: customers and agents prove who they are
with Firebase Auth.

## Recommendations for production

The full go-live list (App Check, API key restrictions, backups, monitoring,
data deletion) is in [production-checklist.md](production-checklist.md).

- Enable [App Check](https://firebase.google.com/docs/app-check) for the
  Realtime Database, Storage and Functions. This limits anonymous sign-up abuse.
- Restrict who can create accounts in Firebase Auth if agents use email/password.
  Accounts carry no privileges, but this keeps your user list clean.
