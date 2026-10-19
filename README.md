# Clayver

Open-source customer support for mobile apps.

Customers chat with you inside your iOS, Android or Flutter app. Your agents
reply from a self-hosted web dashboard. The backend is a set of security rules
and Cloud Functions deployed into **your own Firebase project**, so there's no
Clayver server and your data never leaves your project.

```swift
try await Clayver.configure()   // follows your app's Firebase Auth user
Clayver.openChat()
```

## Get started

```bash
npx clayver init          # detects your app, deploys the backend, wires up push, writes an example
```

Agents can reply in two places:
- **The web dashboard.** `init` writes a `clayver-dashboard/` folder; run `npm start` there (or `npx clayver dashboard start`) and sign in.
- **Your own app.** When the signed-in user holds an agent role (read from the `clayver_roles` claim in their Firebase ID token, and enforced by the database rules), the SDK opens an agent inbox instead of the customer chat. Agents are Firebase Auth accounts of your project; grant the role with `npx clayver admin grant --email <their email>` or from the dashboard's Team page. See [Agent mode](docs/sdk-api.md#agent-mode).

For a support team running Clayver day to day:
- **Several conversations per customer.** The SDK chat opens a conversation list with a "New conversation" button.
- **Priority, status and tags.** Agents set a priority (low, medium, high) and a status (to do, in progress, on hold) on each conversation, create their own tags, and filter the inbox by all three in the dashboard.
- **Internal notes and saved replies** in the dashboard.
- **Blocking and automatic rate limits** for abusive customers.
- **Customer data export and deletion** (GDPR, App Store account deletion).
- **App Check enforcement**, plus a [production checklist](docs/production-checklist.md) and a [release process](docs/releasing.md).

Then read the guide for your platform:
- [iOS](ios/README.md)
- [Android](android/README.md)
- [Flutter](flutter/README.md)
- [Dashboard](dashboard/README.md)
- [Setup CLI](packages/setup/README.md)

## Repository

| Path | What it is |
| --- | --- |
| `packages/setup` | `npx clayver` setup CLI (TypeScript) |
| `packages/core` | Shared typed data model and data access for dashboards (TypeScript) |
| `dashboard` | Self-hostable agent dashboard (React + Vite) |
| `ios` (+ root `Package.swift`) | Native Swift SDK with a SwiftUI chat UI |
| `android` | Native Kotlin SDK with a Jetpack Compose chat UI |
| `flutter` | Flutter plugin that delegates to the native SDKs (Pigeon) |
| `firebase` | `database.rules.json`, `storage.rules`, Cloud Functions, [data model](firebase/database.schema.md), emulator tests |
| `examples/{ios,android,flutter}` | Minimal sample apps |
| `docs` | [Architecture](docs/architecture.md), [security](docs/security.md), [identity](docs/identity.md), [push](docs/push-notifications.md), [SDK API](docs/sdk-api.md), [testing](docs/testing.md) |

The monorepo uses pnpm workspaces and Turborepo for the TypeScript packages:

```bash
pnpm install
pnpm build            # functions, core, dashboard, CLI
pnpm test             # unit tests
pnpm test:emulators   # Firebase Emulator Suite: rules, storage and functions (needs Java 11+)
pnpm emulators        # emulators with rules loaded, for running the dashboard locally
```

## MVP status

Here, "Verified" means it was run in CI-like conditions in this repository's
container. "Written" means the code exists but could not be built here, because
there is no Xcode, Android SDK or device.

| # | Acceptance criterion | Status | Evidence / gaps |
| --- | --- | --- | --- |
| 1 | Developer can initialize Clayver with the setup CLI | Built; unit-tested | `npx clayver init / status / update / remove / admin`. 89 tests cover platform detection, merging the rules and `firebase.json` without overwriting, dry-run, the manifest round trip and secret handling. A real `firebase deploy` against a live project has not been run. |
| 2 | iOS and Android native chat interfaces | Written; Android type-checked | SwiftUI (`ios/Sources/ClayverSDK/UI`) and Compose (`android/clayver/src/main/kotlin/com/clayver/sdk/ui`): conversation list, chat, blocked state, and an agent inbox with tags. The iOS code has not been compiled. The Android SDK, Compose UI included, was type-checked against the Android and Compose APIs, and its 92 pure-Kotlin tests pass on the JVM; a Gradle build has not been run. |
| 3 | Flutter delegates to the native SDKs | Dart verified; Android bridge compiled | Pigeon bridges for the customer chat, multiple conversations, agent mode and tags, with no messaging logic in Dart. `flutter analyze` is clean and 64 plugin tests plus 2 example tests pass. The Kotlin bridge compiles with no warnings against the real Flutter embedding and Android framework (Firebase and androidx stubbed). The Swift bridge was checked by hand but not compiled. |
| 4 | Customers and agents exchange messages in real time | Verified (backend + dashboard) | Emulator tests: message exchange, several conversations per customer, counters, inbox, paging. The dashboard was driven in Chromium. The native UIs have not been run. |
| 5 | Agents authenticate with Firebase Auth | Verified | Dashboard email/password and Google sign-in. Emulator tests confirm a plain account gets no access. |
| 6 | Admins securely grant and revoke agent permissions | Verified | `clayverBootstrapAdmin` and `clayverSetAgentRole` tests: escalation attempts, last-admin protection, immediate revocation, and roles granted to app users by their verified user id (applied to every device that user signs in on, removed when a device switches user). |
| 7 | Push notifications in both directions | Backend verified; delivery not verified | Fan-out, de-duplication, preferences, assignee routing and invalid-token handling are tested with an emulator FCM sink. Real APNs/FCM delivery needs a real project and devices. |
| 8 | Multiple devices and token refresh | Verified (backend) | Tests cover multi-device fan-out, token refresh, a token moving between users, and clearing a registration. |
| 9 | Customer properties and unread counts | Verified (backend) | Property validation rules. Unread counts tested with 30 concurrent writes from three clients. |
| 10 | Self-hostable dashboard | Verified | `npm start` in the generated `clayver-dashboard/`, Firebase Hosting, static host or Dockerfile. A headless Chromium run against the emulators (`firebase/tests/e2e/dashboard.e2e.mjs`, 15 checks) covers sign-in, claiming admin, live messages, replies, tags and the tag filter, internal notes, saved replies, blocking, other conversations of a customer, export, deletion, closing and the Team page. |
| 11 | Data stays in the developer's Firebase project | By design | No Clayver-hosted service exists. Everything deploys to your project. |
| 12 | Security rules prevent unauthorized access | Verified | 52 rules and Storage tests: isolation, sender spoofing, role escalation, validation, workspace boundaries, tags and notes hidden from customers, blocked customers can't write. 93 emulator tests in total. |
| 13 | Documentation and working examples | Written | `docs/`, per-package READMEs, `examples/*`. The examples have not been built here. |

### Before a first release, on a machine with Xcode and the Android SDK
1. `cd ios && xcodebuild test -scheme ClayverSDK -destination 'platform=iOS Simulator,name=iPhone 16'`, then fix compile issues.
2. `cd android && ./gradlew :clayver:testDebugUnitTest`. Run `FirebaseConstantsTest` first.
3. Build `examples/*` against a real Firebase project and check both push directions on physical devices.

## License

Apache-2.0
