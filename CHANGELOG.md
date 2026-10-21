# Changelog

All notable changes to Clayver are documented in this file. Every package in
this repository (the iOS, Android and Flutter SDKs, the `clayver` CLI,
`@clayver/core`, the dashboard and the Firebase backend) shares one version.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Before 1.0.0, a minor version (0.x.0) may contain breaking changes; they are
listed under **Changed** or **Removed** with upgrade notes.

## [Unreleased]

## [0.3.0] - 2026-10-21

### Added

- Agents switch sides inside the support UI: `openChat()` shows a **Switch to
  support agent** button under **New conversation** to users with an agent
  role, which turns the screen into the team inbox, and the inbox has a
  **Switch to regular user** button. The choice is remembered per user and
  workspace on the device (`UserDefaults` / SharedPreferences), so the next
  `openChat()` without a conversation id opens the same side. Agent pushes
  open the inbox on their conversation. iOS and Android; Flutter gets it
  through the native UI.

### Fixed

- Android: tapping a Clayver notification shown while the app was in the
  background did nothing. Pushes set the click action
  `CLAYVER_OPEN_CONVERSATION`, which no activity handled; `ClayverChatActivity`
  now does, opening the conversation (agent pushes: agent mode) and returning
  into the app on close. Cold starts before `configure` hand the tap to the
  launcher activity (`Clayver.handleIntent`, Flutter `getInitialMessage`).
- iOS: the customer's conversation list never showed unread badges. Inbox
  entries store `unread` as a number, which the parser did not read.

### Removed

- `openAgentInbox()` (iOS, Android, Flutter) and Android's
  `ClayverAgentInboxActivity`: agents reach the inbox from `openChat()`.
  `ClayverAgentInboxView` / `ClayverAgentInboxScreen` stay for custom
  navigation.

- CocoaPods support. The iOS SDK ships through Swift Package Manager only
  (root `Package.swift`), and the Flutter plugin's iOS side is its Swift
  package (`flutter/ios/clayver/Package.swift`); Flutter apps need
  `flutter config --enable-swift-package-manager`. The setup CLI no longer
  edits Podfiles.

## [0.2.0] - 2026-10-20

### Changed

- The `clayver` and `@clayver/core` packages point their repository, homepage, and issues links at `github.com/MarioIannotta/clayver`.

## [0.1.1] - 2026-10-20

### Changed

- **Functions are a dependency, like the dashboard.** `npx clayver init` writes
  `clayver-functions/package.json` and `index.js` that depend on the `clayver`
  package and re-export `clayver/functions`. The compiled function source is
  no longer copied into the app. `npx clayver update` bumps that dependency
  and deletes source an older CLI copied.

### Added

- **Special user property keys.** `Clayver.UserProperty.name`, `.email` and
  `.uid` (Kotlin `NAME`/`EMAIL`/`UID`, Flutter `Clayver.userProperty`) set the
  customer's name, email and your own user id, which the dashboard and the
  agent views show specially ("User ID" for `uid`). Stored as `_name`,
  `_email` and `_uid`; values must be strings.
- **Priority and status on conversations.** Agents set a priority (low,
  medium, high) and a status (to do, in progress, on hold) from the dashboard,
  and filter the inbox by both. Agents can rename, recolor, reorder, add and
  remove the choices in Settings (`triageOptions/`); the lists above are the
  defaults. Stored agent-only in `triage/{conversationId}`.
- **Details sheet in the mobile agent chat** (iOS and Android): a "…" button
  opens the customer's info, their conversations, assignee, open/closed,
  priority, status, tags, internal notes and block controls.
- **Notification prompt in the customer chat** (iOS and Android): a banner asks
  for notification permission, or points to the system settings once denied
  (`showsNotificationPrompt` / `showNotificationPrompt`, default on).
- **Agents change their own display name** in the dashboard's Settings.
- **Anonymous sign-in switch** for admins in the dashboard's Settings
  (`clayverAuthSettings` callable; a project-wide Firebase Auth setting).
- **Photos are compressed before upload** to a JPEG of at most 300 KiB, in the
  iOS, Android and Flutter SDKs (UI and programmatic sends) and the dashboard.
- **Styled dropdowns** in the dashboard.

- **Agent mode in the iOS and Android SDKs.** A person with an agent or admin
  role can answer customers from inside any app that embeds the SDK: inbox,
  replies, open/close, assign to me, and agent push notifications. Agents are
  Firebase Auth accounts granted a role by email or uid.
- **Agent mode in the Flutter plugin**, bridged to the native SDKs with Pigeon
  on Android and iOS.
- **Dashboard with `npm start`.** `npx clayver init` registers a web app and
  writes `clayver-dashboard/`; `npm start` serves the prebuilt dashboard that
  ships inside the `clayver` package, and `npm run deploy` publishes it to
  Firebase Hosting. The dashboard reads its config at runtime
  (`clayver.config.json`), so one build serves every project.
- **Multiple conversations per customer.** A conversation list in the SDK UIs,
  `openConversations()`, `openNewConversation()` and `startConversation()`;
  `ClayverOptions.multipleConversations` (default `true`).
- **Conversation tags** with a workspace tag catalog that agents fill (no
  default tags) and a tag index for filtered inbox queries.
- **Internal notes** on conversations, visible to agents only and never pushed.
- **Saved replies** shared by the team.
- **Customer blocking and automatic rate limits.** Agents block and unblock
  customers (`moderation/{customerId}`); functions apply temporary
  `rate_limit` blocks above `messagesPerMinute` (default 30) or
  `conversationsPerHour` (default 10), configurable in
  `config/private/rateLimits`. The SDKs expose `blockStatus()` and replace the
  composer while a block is active.
- **Customer data export and deletion.** `clayverDeleteMyData` (the customer,
  via `deleteCustomerData()` in the SDKs), `clayverDeleteCustomer` and
  `clayverExportCustomer` (admins) for GDPR requests and App Store account
  deletion.
- Optional App Check enforcement on callable functions
  (`CLAYVER_ENFORCE_APP_CHECK=true`). See
  [docs/production-checklist.md](docs/production-checklist.md).
- `ClayverOptions.signInAnonymously` (default `true`) on iOS, Android and
  Flutter. With `false`, the SDK never signs in anonymously and calls fail with
  `notAuthenticated` until the host app signs a user in.
- `users/{customerId}/account`: a server-written snapshot of the customer's
  Firebase Auth account (`anonymous`, `email`, `emailVerified`,
  `displayName`), shown to agents in the dashboard and the in-app agent views
  (`ClayverCustomerProfile.account`).
- Release tooling: one version for every package (`scripts/version.mjs`,
  `scripts/check-versions.mjs`) and a release workflow that publishes to npm,
  pub.dev, Maven Central and CocoaPods trunk.

### Changed

- **Custom property keys can't start with `_`**, which is reserved for the
  user property keys above. The plain `name` and `email` properties are no
  longer shown specially; use `UserProperty.name` and `UserProperty.email`.
- **Identity is Firebase Auth only.** Customers and agents are Firebase Auth
  users of the host app's project, and the customer id is always the Firebase
  uid. The SDKs follow the host app's signed-in user on their own: push
  registrations move to the new uid when the user changes. Upgrade: sign
  users in with Firebase Auth instead of calling `identify`, and call
  `Clayver.logout()` right before your own `signOut()`. To keep an anonymous
  user's conversations on sign-up, link the credential to the anonymous user.
  See [docs/identity.md](docs/identity.md).
- `logout()` no longer signs in a new anonymous user right away, and never
  signs out the host app's own user.
- `clayverSetAgentRole` and `clayver admin grant|revoke` take exactly one of
  `email` or `uid` (`--email` / `--uid`).
- `ClayverCustomerProfile.externalId` is replaced by `account`.
- Push tokens are registered per audience, so one phone can hold a customer
  registration and an agent registration at the same time.
- The CocoaPods spec now uses the release tag `v<version>` (it was
  `ios-v<version>`), the same tag Swift Package Manager resolves.

### Removed

- **"Resolved" label** in the customer conversation list: customers no longer
  see that an agent closed a conversation.
- **File attachments other than photos.** PDF, text and ZIP files can no
  longer be sent, and the attachment limit is now 300 KiB (photos are
  compressed to fit). The generic attachment button is gone from the SDK chat
  UIs; only the photo picker remains.
- `identify(userId, userHash)` in every SDK, the `clayverIdentify` function,
  the `clayver_cid` custom claim and `v_` customer ids.
- `CLAYVER_IDENTITY_SECRET`, `CLAYVER_ALLOW_UNVERIFIED_IDENTITY` and
  `clayver update --rotate-secret`. An existing secret is no longer read; delete
  it with `firebase functions:secrets:destroy CLAYVER_IDENTITY_SECRET`.
- Role grants to app user ids (`roleGrants/`, `identityLinks/`,
  `clayver admin grant --user-id`, the dashboard's "Grant by app user id"), and
  `users/{customerId}/externalId` and `identityType`.

## [0.1.0] - 2026-10-16

First public version: the minimum viable product.

### Added

- **Firebase backend** that runs in the developer's own project: Realtime
  Database and Storage security rules under a `clayver/` namespace, and Cloud
  Functions for identity verification (`clayverIdentify`, HMAC-SHA256 user
  hashes with `CLAYVER_IDENTITY_SECRET` in Secret Manager), roles
  (`clayverBootstrapAdmin`, `clayverSetAgentRole`), message fan-out, unread
  counters, read receipts, welcome messages and push notifications through
  FCM. Covered by Firebase Emulator Suite tests.
- **iOS SDK** (`ClayverSDK`, Swift Package Manager and CocoaPods): configure,
  identify, logout, customer properties, push token registration, unread
  counts, a SwiftUI/UIKit chat with attachments, and push handling.
- **Android SDK** (`com.clayver:clayver-android`, Kotlin and Jetpack Compose)
  with the same API.
- **Flutter plugin** (`clayver`), a thin wrapper over the native SDKs.
- **Agent dashboard** (React + Vite, self-hostable): sign-in, inbox with live
  updates, conversation view with attachments and read receipts,
  open/close/assign, customer details, team management and browser push.
- **`@clayver/core`**, the typed data model and Firebase data-access layer the
  dashboard is built on.
- **`clayver` setup CLI** (`npx clayver init`): detects the app, picks the
  Firebase project, merges the rules, deploys the functions, creates the
  identity secret, guides push setup, writes example code, and records every
  change in `clayver.json` for `status`, `update` and `remove`.
  `clayver admin grant|revoke` manages agents.
- Example apps for iOS, Android and Flutter, and documentation of the data
  model, SDK API contract, security model, identity verification and push.

[Unreleased]: https://github.com/MarioIannotta/clayver/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/MarioIannotta/clayver/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/MarioIannotta/clayver/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/MarioIannotta/clayver/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/MarioIannotta/clayver/releases/tag/v0.1.0
