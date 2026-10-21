# ClayverSDK for iOS

Native iOS SDK for [Clayver](../README.md): in-app customer support chat whose backend runs
entirely in **your own Firebase project** (Realtime Database, Cloud Storage, Cloud
Functions, Firebase Cloud Messaging).

- Swift 5.9, iOS 15+, Swift concurrency (`async`/`await`, `AsyncThrowingStream`)
- SwiftUI chat UI (`ClayverChatView`, `ClayverConversationListView`) and a one-line UIKit
  presenter (`Clayver.openChat()`)
- Several conversations per customer, with a conversation list
- Real-time messages, history paging, unread counts, read receipts, photo attachments,
  push notifications with deep links
- Agent mode: support staff with an agent/admin role answer customers from the same app
  (`Clayver.openChat()` offers agents a switch to the team inbox, `ClayverAgentInboxView`), with tags
- Depends on `firebase-ios-sdk` 11.x or 12.x: FirebaseAuth, FirebaseDatabase, FirebaseStorage,
  FirebaseFunctions, FirebaseMessaging

> **Status: not yet compiled.** This package was written in an environment without an Apple
> toolchain, so it has not been built or tested with Xcode yet. The code targets the public
> Firebase iOS SDK 11 APIs and iOS 15 SwiftUI APIs; expect a round of small compile fixes
> on first build. Run the unit tests with
> `xcodebuild test -scheme ClayverSDK -destination 'platform=iOS Simulator,name=iPhone 15'`
> from this folder.

The data contract (paths, fields, push payload, callable functions) is
[`firebase/database.schema.md`](../firebase/database.schema.md); the cross-platform API is
[`docs/sdk-api.md`](../docs/sdk-api.md).

## Installation

### Swift Package Manager

Swift Package Manager is the only supported installation method (there is no CocoaPods pod).

- **By URL**: Xcode → File → Add Package Dependencies… → enter the repository URL (the
  manifest is `Package.swift` at the repository root) → add the `ClayverSDK` library to
  your app target.
- **Local / monorepo checkout**: Xcode → File → Add Package Dependencies… → **Add Local…** →
  select the `ios` folder (`ios/Package.swift`, the same package for local development).

```swift
// In another package's Package.swift
.package(path: "../clayver/ios")
// ...
.product(name: "ClayverSDK", package: "ClayverSDK")
```

## Firebase setup

1. Deploy the Clayver backend into your Firebase project with the setup CLI (database rules,
   storage rules, Cloud Functions).
2. Add an iOS app in the Firebase console and add `GoogleService-Info.plist` to your target.
3. Enable the sign-in providers your app uses (Authentication → Sign-in method), plus
   **Anonymous**: Clayver signs in anonymously when your app has no Firebase user, unless you
   pass `ClayverOptions(signInAnonymously: false)`.

## Quick start

```swift
import ClayverSDK

// At launch (after or instead of FirebaseApp.configure())
try await Clayver.configure()

// Sign users in with Firebase Auth as usual; Clayver follows the signed-in user.
// Optional context for agents:
try await Clayver.setUserProperties(["name": .string(user.name), "plan": "pro"])

// Open the chat (UIKit or SwiftUI host)
Clayver.openChat()

// Signing out: remove this device's push registration first
try await Clayver.logout()
try Auth.auth().signOut()
```

SwiftUI:

```swift
.sheet(isPresented: $showSupport) {
    ClayverSupportView(onClose: { showSupport = false })   // same screens as openChat()
}
```

The chat shows Close at the top right. Opened from the list (or by `openChat()` /
`ClayverSupportView` with multiple conversations), it also has a back button at the top left
that leads to the customer's conversation list; the list has Close at the top right.
To show only the chat, put `ClayverChatView(onClose:)` in a `NavigationView` yourself.

Several conversations: with `ClayverOptions.multipleConversations` (the default),
`openChat()` shows the customer's conversations (or, when there are none yet, a new empty chat
pushed over the list).

```swift
Clayver.openConversations()        // always the list
Clayver.openNewConversation()      // an empty chat; the conversation is created on the first send
try await Clayver.startConversation(text: "Order #1234 arrived damaged")   // in code

// SwiftUI
NavigationView { ClayverConversationListView(onClose: { showSupport = false }) }
```

Unread badge:

```swift
.task {
    for try await count in Clayver.unreadCountUpdates() { unread = count }
}
```

## Push notifications (APNs + FCM)

Clayver's Cloud Functions send pushes through FCM to the tokens registered at
`devices/customers/{cid}/{deviceId}`.

1. **Xcode**: add the *Push Notifications* capability and *Background Modes → Remote
   notifications*.
2. **Apple Developer portal**: create an APNs authentication key (.p8).
3. **Firebase console** → Project settings → Cloud Messaging → *Apple app configuration*:
   upload the .p8 key with its Key ID and your Team ID.
4. **App code**:

```swift
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate, MessagingDelegate {
    func application(_ app: UIApplication, didFinishLaunchingWithOptions _: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        FirebaseApp.configure()
        Task { try? await Clayver.configure() }
        UNUserNotificationCenter.current().delegate = self
        Messaging.messaging().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            if granted { DispatchQueue.main.async { app.registerForRemoteNotifications() } }
        }
        return true
    }

    func application(_ app: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
        Task { try? await Clayver.setPushToken(token) }   // APNs → FCM → registration
    }

    func messaging(_ messaging: Messaging, didReceiveRegistrationToken token: String?) {
        if let token { Task { try? await Clayver.setFCMToken(token) } }
    }

    func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler done: @escaping () -> Void) {
        Clayver.handleNotification(userInfo: response.notification.request.content.userInfo)
        done()
    }
}
```

`handleNotification` returns `true` for Clayver pushes and opens the chat on the pushed
conversation. On a cold start it waits for `configure` to finish. Use
`Clayver.isClayverNotification(userInfo:)` to tell Clayver pushes apart in `willPresent`.

`setPushToken` requires the **default** `FirebaseApp` (FirebaseMessaging only supports the
default app). With a secondary app, obtain the FCM token yourself and call `setFCMToken`.

**Notification prompt in the chat.** While notifications are off, `ClayverChatView` shows a
dismissible banner at the top ("Turn on notifications to know when we reply."). If permission
was never asked, tapping it shows the system prompt and, when granted, calls
`UIApplication.shared.registerForRemoteNotifications()` (your app delegate still forwards the
token to `setPushToken`). If the customer denied it, tapping it explains that notifications
must be enabled in Settings and offers **Open Settings**. The banner re-checks when the app
returns to the foreground, stays hidden for a day after it is dismissed, and is never shown
once notifications are allowed. Turn it off with `ClayverOptions(showsNotificationPrompt: false)`
if your app asks for permission elsewhere.

## API reference

All async APIs throw `ClayverError` (or `CancellationError` when the calling task is
cancelled). Calls made while `configure` is still running wait for it.

| API | Description |
| --- | --- |
| `Clayver.configure(_ options: ClayverOptions = .init()) async throws` | Picks the Firebase app (`options.firebaseApp`, else the default app, else `FirebaseApp.configure()`), signs in anonymously if needed (unless `signInAnonymously` is `false`), starts following Firebase Auth sign-ins, creates the Keychain device id. Idempotent. |
| `Clayver.logout() async throws` | Removes this device's push registrations for the signed-in user. Call it right before `Auth.auth().signOut()`. Signs out an anonymous user itself; never your own user. |
| `Clayver.customerId() async throws -> String` | The Firebase uid. |
| `Clayver.setUserProperties([String: ClayverValue]) async throws` | Validated, then written to `users/{cid}/properties`. |
| `Clayver.setPushToken(Data) async throws` | APNs token → `Messaging.apnsToken` → FCM token → registration. |
| `Clayver.setFCMToken(String) async throws` | Registers an FCM token directly. |
| `Clayver.clearPushToken() async throws` | Removes this device's registration. |
| `Clayver.getUnreadMessagesCount() async throws -> Int` | `inbox/{cid}/unreadTotal`. |
| `Clayver.unreadCountUpdates() -> AsyncThrowingStream<Int, Error>` | Live unread total. |
| `Clayver.conversations() -> AsyncThrowingStream<[ClayverConversation], Error>` | Live `inbox/{cid}/conversations`, newest first. |
| `Clayver.messages(conversationId:limit:) -> AsyncThrowingStream<[ClayverMessage], Error>` | Live newest `limit` (default 30) messages, `orderByKey().limitToLast`. |
| `Clayver.loadOlderMessages(conversationId:before:limit:) async throws -> [ClayverMessage]` | History page, `orderByKey().endBefore(before).limitToLast(limit)`. |
| `Clayver.sendMessage(text:conversationId:attachment:) async throws -> ClayverMessage` | Uses the given conversation, else the newest open one, else creates one. Images only (any `image/*`: JPEG, PNG, GIF, WebP, HEIC); they are downscaled (longest side ≤ 1600 px) and re-encoded as JPEG of at most 300 KB before upload. Other types throw `unsupportedAttachmentType`. |
| `Clayver.startConversation(text:attachment:) async throws -> ClayverMessage` | Always creates a new conversation for the message. |
| `Clayver.markConversationRead(_:) async throws` | Writes `reads/{id}/customer/lastReadAt`. |
| `Clayver.blockStatus() -> AsyncThrowingStream<ClayverBlockStatus?, Error>` | `ClayverBlockStatus(reason:until:)` while `moderation/{cid}` holds an active block (`blocked` and no `until` or `until` in the future; re-evaluated when `until` passes), else `nil`. Blocked sends fail with `permissionDenied`. |
| `Clayver.deleteCustomerData() async throws` | Calls `clayverDeleteMyData` (erases the customer's conversations, messages, attachments, properties and devices), then `logout()`. Use it in your account deletion flow. |
| `Clayver.isClayverNotification(userInfo:) -> Bool` | Checks the `clayver: "1"` marker. |
| `Clayver.handleNotification(userInfo:) -> Bool` | Opens the chat for a tapped Clayver push (the agent conversation view for `audience: "agent"` pushes). |
| `@MainActor Clayver.openChat(conversationId:from:)` | Presents the chat modally (page sheet) from the given or top-most view controller. With `multipleConversations`, no id opens the conversation list (or a new chat pushed over it when the customer has none), an id opens that conversation with a back button to the list. Close (top right) dismisses it. |
| `ClayverSupportView(conversationId:theme:onClose:)` | The same screens as `openChat`, in their own `NavigationView`, for SwiftUI sheets. |
| `@MainActor Clayver.openConversations(from:)` | Presents the conversation list. |
| `@MainActor Clayver.openNewConversation(from:)` | Presents an empty chat (on top of the list with `multipleConversations`). |
| `ClayverConversationListView(theme:onClose:)` / `ClayverConversationListView(viewModel:theme:onClose:)` | SwiftUI list: last message (or "Attachment"), time, unread badge and a **New conversation** button. Customers are not shown whether the team closed a conversation. |
| `ClayverChatView.newConversation(theme:onClose:)` | An empty chat whose first message creates a new conversation. |
| `ClayverChatView(conversationId:theme:onClose:)` | SwiftUI chat screen. Put it in a `NavigationView`/`NavigationStack`. |
| `ClayverChatView(viewModel:theme:onClose:)` | Same, driven by your own `ClayverChatViewModel` / `ClayverChatDataSource` (previews, tests). |
| `Clayver.chatDataSource` | The Firebase-backed `ClayverChatDataSource`. |

Agent mode APIs are listed in [Agent mode](#agent-mode).

### Options

```swift
ClayverOptions(
    projectId: "default",              // Clayver workspace, ^[a-z0-9-]{1,40}$
    functionsRegion: "us-central1",
    databaseURL: nil,                   // non-default RTDB instance
    firebaseApp: nil,                   // defaults to FirebaseApp.app()
    theme: ClayverTheme(title: "Help", accentColor: .indigo),
    useEmulator: nil,                   // .init(host: "localhost") in debug builds
    multipleConversations: true,        // false: openChat() opens the latest conversation, no list
    signInAnonymously: true,            // false: require a signed-in Firebase user
    showsNotificationPrompt: true       // false: no "turn on notifications" banner in the chat
)
```

### Theme

`ClayverTheme(title:accentColor:customerBubbleColor:customerTextColor:agentBubbleColor:agentTextColor:bodyFont:captionFont:headlineFont:)`.
Fonts default to Dynamic Type text styles; for custom typefaces use
`Font.custom(_:size:relativeTo:)` so they keep scaling.

### Errors

`ClayverError` cases and their stable `code`s: `notConfigured`, `notAuthenticated`,
`permissionDenied`, `invalidArgument(String)`, `network`,
`attachmentTooLarge(size:limit:)`, `unsupportedAttachmentType(String)`, `cancelled`,
`internal(String)`. Firebase errors are mapped by domain/code (Auth, Database, Storage,
Functions, `NSURLErrorDomain`); `ClayverError.from(_:)` is public if you need the same mapping.

### Cancellation

Cancelling the calling `Task` cancels in-flight reads and attachment uploads and throws
`CancellationError`. Streams remove their Firebase listeners in `onTermination`, i.e. as soon
as the consuming task is cancelled or stops iterating. Callable functions and database writes
cannot be aborted once sent; the SDK checks for cancellation between steps.

## Identity

Customers and agents are Firebase Auth users of your app's Firebase project, and the customer
id is the Firebase uid. The SDK follows the signed-in user (`addStateDidChangeListener`): when
it changes, this device's push registration moves to the new uid. There is no secret and no
extra backend.

With nobody signed in, the SDK signs in anonymously so people can chat before they log in. To
keep those conversations when they create an account, link the credential to the anonymous user
instead of creating a new one; the uid stays the same:

```swift
let credential = EmailAuthProvider.credential(withEmail: email, password: password)
if let user = Auth.auth().currentUser, user.isAnonymous {
    try await user.link(with: credential)
} else {
    try await Auth.auth().createUser(withEmail: email, password: password)
}
```

See [docs/identity.md](../docs/identity.md).

## Chat UI

- Real-time messages with optimistic sends ("Sending…", "Not sent. Retry"), history paging
  when scrolling to the top, day headers and per-message timestamps
- "New messages" divider based on the customer's read marker at open time; the
  conversation is marked read while the chat is visible
- "Seen" receipt on the last customer message the team has read (`reads/{id}/agent`)
- Photo attachments only (`PhotosPicker` on iOS 16+, `PHPickerViewController` on iOS 15);
  there is no file picker. Every photo is downscaled (longest side ≤ 1600 px) and re-encoded
  as a JPEG of at most 300 KB (`ClayverImageCompressor`) before upload. Tapping an
  attachment opens it in Quick Look.
- Loading, error (with retry), empty (workspace welcome message) and connection-lost states
- While the customer is blocked (`blockStatus()`), "You can't send messages right now."
  replaces the composer
- Conversation list (`ClayverConversationListView`): newest first, unread badges; closed
  conversations look like any other (customers are never told a conversation was closed), and
  writing in one reopens it
- VoiceOver labels and actions (retry, delete, open attachment), Dynamic Type throughout

## Agent mode

Support agents can answer customers from the app that embeds the SDK, in addition to the web
dashboard. Agent features are enabled for a signed-in Firebase user whose ID token
carries the claim `clayver_roles[projectId]` = `"agent"` or `"admin"`.

### Granting a role

Agents are Firebase Auth accounts in the same project. Your app signs the person in (email,
Google, …) and an admin grants a role to that account by email or uid, exactly as for the
dashboard: in the dashboard's team settings, or with
`clayver admin grant --email <email> --role agent`.

A fresh sign-in carries a fresh ID token, so a granted role applies right after login. Call
`Clayver.agentRole(forceRefresh: true)` to pick up a grant or revocation made while the app is
running.

> **The JWT is for the UI only.** The SDK reads the role from the ID token to decide whether to
> show agent features and fails agent calls early with `permissionDenied` when it is missing.
> The Realtime Database and Storage rules are the authority: they check
> `agents/{auth.uid}/active` on every read and write, so a stale or forged claim opens nothing,
> and a revoked agent loses access on the next operation.

### Showing the inbox

There is no separate entry point for agents. `Clayver.openChat()` (and `ClayverSupportView`)
shows agents a **Switch to support agent** button under **New conversation**, which turns the
screen into the team inbox; the inbox has a **Switch to regular user** button. The choice is
remembered per user on the device, so the next `openChat()` (without a `conversationId`) or
`openConversations()` opens the same side. Agent pushes open the inbox on their conversation.

```swift
Clayver.openChat()                                 // agents can switch to the inbox from here

// SwiftUI, with your own navigation
.sheet(isPresented: $showInbox) {
    NavigationView { ClayverAgentInboxView(onClose: { showInbox = false }) }
        .navigationViewStyle(.stack)
}
```

The inbox has Open and Closed tabs. Rows show the customer (`Clayver.UserProperty.name`, else the
account's name or email, else a short customer id), the last message, its relative time, the team's
unread count (`unread.agent`) and whether the conversation is assigned (to you or a teammate).
A conversation shows customer messages on the left and team replies on the right, loads older
messages when scrolling up, sends text and photos (compressed like the customer's), shows "Seen" from the customer's read
marker. A summary line under the navigation bar shows Open/Closed, priority, status, assignee
and tags. The "…" button opens the **Details** sheet: the customer (name, email, account, id,
last seen, properties), assignee (Assign to me/Unassign), Open/Closed, **Priority** and
**Status** pickers ("None" plus the workspace's options, from `triageOptions`; a value not in
the list shows as None), tags, internal notes (newest first; swipe to delete your own), the
customer's other conversations (tap to open one) and Block/Unblock. While visible, it writes
the shared team read marker `reads/{id}/agent`.

Priority and status live in `triage/{conversationId}` (`priority`, `stage`), agents only. When
a list was never saved in the dashboard the defaults apply: priority High/Medium/Low, status
To do/In progress/On hold.

**Tags.** The conversation's tags show as colored chips in the summary line and in Details. "Add tag" opens a
sheet that searches the workspace catalog, toggles tags on the conversation, and offers
"Create tag “…”" when no tag has the typed name. The inbox has a tag filter row (All + every
tag) under the Open/Closed tabs. A new tag's id is the slug of its name (`ClayverTagRules.slug`,
e.g. "Waiting on customer" → `waiting-on-customer`); creating a name whose slug exists returns
the existing tag, and without a color the palette color is picked from the slug.

### Push notifications for agents

No extra code: when the signed-in user is an agent, `setPushToken` / `setFCMToken` also
register the token under `devices/agents/{uid}/{deviceId}`. A sign-in and
`agentRole(forceRefresh: true)` re-evaluate the registration, and `logout`, `clearPushToken` and
losing the role remove it. `handleNotification(userInfo:)` opens the agent conversation for
pushes with `audience: "agent"`, and the customer chat for customer pushes as before.

### API

| API | Description |
| --- | --- |
| `Clayver.agentRole(forceRefresh: Bool = false) async throws -> ClayverAgentRole?` | `.admin`, `.agent` or `nil`, from `clayver_roles[projectId]`. |
| `Clayver.isAgent() async throws -> Bool` | `agentRole() != nil`. |
| `Clayver.agentConversations(status: .open, limit: 50, tagId: nil) -> AsyncThrowingStream<[ClayverAgentConversation], Error>` | Live list via `orderByChild('statusOrder')`, newest activity first. With a `tagId`, reads `tagIndex/{tagId}` (same range and limit) and observes each conversation. |
| `Clayver.tags() -> AsyncThrowingStream<[ClayverTag], Error>` | Live tag catalog (`id`, `name`, `color` as `#rrggbb`), by name. |
| `Clayver.createTag(name:color:) async throws -> ClayverTag` | Creates `tags/{slug}`, or returns the existing tag with that slug. |
| `Clayver.conversationTags(conversationId:) -> AsyncThrowingStream<[String], Error>` | Live tag ids of a conversation. |
| `Clayver.addTag(_:to:)` / `Clayver.removeTag(_:from:) async throws` | Sets or removes `conversationTags/{conversationId}/{tagId}`. |
| `Clayver.customerProfile(customerId:) -> AsyncThrowingStream<ClayverCustomerProfile, Error>` | Live `users/{customerId}` (`account`, `properties`, `lastSeenAt`, `displayName`). `ClayverCustomerAccount`: `anonymous`, `email`, `emailVerified`, `displayName`. |
| `Clayver.messages(conversationId:)` / `loadOlderMessages(...)` | Same as for customers. |
| `Clayver.sendAgentReply(conversationId:text:attachment:) async throws -> ClayverMessage` | `senderType: "agent"`, `senderId: auth.uid`, `senderName` from `agents/{uid}/displayName`; images are compressed to a JPEG of at most 300 KB and stored under the conversation's customer. |
| `Clayver.setConversationStatus(_:_:) async throws` | `.open` / `.closed`. |
| `Clayver.assignConversation(_:toMe:) async throws` | Sets `assigneeUid` to your uid, or removes it. |
| `Clayver.markConversationReadAsAgent(_:) async throws` | Writes `reads/{id}/agent = { lastReadAt, uid }`. |
| `Clayver.triageUpdates(conversationId:) -> AsyncThrowingStream<ClayverTriage, Error>` | Live `triage/{id}`: `priority` and `stage` option ids. |
| `Clayver.triageOptionsUpdates() -> AsyncThrowingStream<ClayverTriageOptions, Error>` | Live priority and status lists (`ClayverTriageOption`: `id`, `name`, `color`, `order`), defaults for unsaved lists. |
| `Clayver.setConversationPriority(_:_:)` / `Clayver.setConversationStage(_:_:) async throws` | Sets an option id, or clears with `nil`. |
| `Clayver.notes(conversationId:)` / `addNote(_:text:)` / `deleteNote(_:noteId:)` | Internal notes (`ClayverInternalNote`), newest first; immutable, deletable by the author or an admin. |
| `Clayver.customerConversations(customerId:) -> AsyncThrowingStream<[ClayverAgentConversation], Error>` | All conversations of a customer, newest activity first. |
| `Clayver.customerBlockStatus(customerId:)` / `blockCustomer(_:reason:until:)` / `unblockCustomer(_:)` | Reads, writes or removes `moderation/{customerId}` (`reason`: spam, abuse or other; `until: nil` lasts until unblocked). |
| `ClayverAgentInboxView(conversationId:theme:onClose:onSwitchToCustomer:)` / `ClayverAgentConversationView(conversationId:theme:)` | SwiftUI screens; `viewModel:` initializers take your own `ClayverAgentInboxViewModel` / `ClayverAgentConversationViewModel`. |
| `Clayver.agentDataSource` | The Firebase-backed `ClayverAgentDataSource` (implement the protocol for previews and tests). |

## Platform notes

- iOS 15+. `openChat` and `handleNotification` are unavailable in app extensions.
- `configure` keeps the first options; call it once.
- The device id is a random 32-character id in the Keychain
  (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, service `com.clayver.sdk`). The last
  FCM token is remembered in `UserDefaults` so the registration can follow the signed-in user.
- `logout()` only signs out **anonymous** Firebase users. If the current user is a
  non-anonymous user of your app, Clayver leaves your sign-in alone (sign out yourself).
- Without persistence enabled, Realtime Database reads wait for a connection; offline,
  the chat stays in its loading state until the network returns.
- Streams opened before the Firebase user changes keep using the previous customer id;
  re-create them afterwards (e.g. `.task(id: Auth.auth().currentUser?.uid)`). `ClayverChatView` creates its streams when it
  appears.
