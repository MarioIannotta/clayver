# Clayver SDK public API (parity contract)

The iOS SDK and the Android SDK are the primary implementations and expose the
same capabilities. The Flutter plugin forwards every call to them.
Data paths and payloads are defined in [`firebase/database.schema.md`](../firebase/database.schema.md).

| Capability | Swift (`ClayverSDK`) | Kotlin (`com.clayver.sdk.Clayver`) | Dart (`package:clayver`) |
| --- | --- | --- | --- |
| Initialize | `try await Clayver.configure(_ options: ClayverOptions = .init())` | `suspend fun configure(context: Context, options: ClayverOptions = ClayverOptions())` | `Future<void> configure({ClayverOptions? options})` |
| Logout | `try await Clayver.logout()` | `suspend fun logout()` | `Future<void> logout()` |
| Customer properties | `try await Clayver.setUserProperties([String: ClayverValue])` | `suspend fun setUserProperties(properties: Map<String, Any>)` | `Future<void> setUserProperties(Map<String, Object>)` |
| Special property keys | `Clayver.UserProperty.name` / `.email` / `.uid` | `Clayver.UserProperty.NAME` / `EMAIL` / `UID` | `Clayver.userProperty.name` / `.email` / `.uid` |
| Push token (APNs) | `try await Clayver.setPushToken(_ apnsToken: Data)` | n/a | `Future<void> setPushToken(String token)` (FCM token on both) |
| Push token (FCM) | `try await Clayver.setFCMToken(_ token: String)` | `suspend fun setPushToken(token: String)` | `Future<void> setPushToken(String token)` |
| Clear registration | `try await Clayver.clearPushToken()` | `suspend fun clearPushToken()` | `Future<void> clearPushToken()` |
| Unread count | `try await Clayver.getUnreadMessagesCount() -> Int` | `suspend fun getUnreadMessagesCount(): Int` | `Future<int> getUnreadMessagesCount()` |
| Observe unread | `Clayver.unreadCountUpdates() -> AsyncThrowingStream<Int, Error>` | `fun unreadCountFlow(): Flow<Int>` | `Stream<int> get unreadCountStream` |
| Open chat | `@MainActor Clayver.openChat(conversationId: String? = nil, from: UIViewController? = nil)` and SwiftUI `ClayverChatView()` | `fun openChat(context: Context, conversationId: String? = null)` and Compose `@Composable ClayverChatScreen()` | `Future<void> openChat({String? conversationId})` |
| Handle push | `Clayver.handleNotification(userInfo:) -> Bool` | `Clayver.handleNotification(context, data: Map<String,String>): Boolean` | `Future<bool> handleNotification(Map<String, dynamic> data)` |
| Is Clayver push | `Clayver.isClayverNotification(userInfo:)` | `Clayver.isClayverNotification(data)` | `Clayver.isClayverNotification(data)` |
| Conversations | `Clayver.conversations() -> AsyncThrowingStream<[ClayverConversation], Error>` | `fun conversationsFlow(): Flow<List<ClayverConversation>>` | `Stream<List<ClayverConversation>> conversations()` |
| Messages | `Clayver.messages(conversationId:) -> AsyncThrowingStream<[ClayverMessage], Error>` + `loadOlderMessages(conversationId:before:limit:)` | `fun messagesFlow(conversationId)` + `suspend fun loadOlderMessages(...)` | `Stream<List<ClayverMessage>> messages(conversationId)` + `loadOlderMessages` |
| Send | `try await Clayver.sendMessage(text:conversationId:attachment:) -> ClayverMessage` | `suspend fun sendMessage(text: String?, conversationId: String? = null, attachment: ClayverAttachmentInput? = null): ClayverMessage` | `Future<ClayverMessage> sendMessage({String? text, String? conversationId, ...})` |
| Mark read | `try await Clayver.markConversationRead(_ id: String)` | `suspend fun markConversationRead(conversationId: String)` | `Future<void> markConversationRead(String id)` |
| Open conversation list | `@MainActor Clayver.openConversations(from: UIViewController? = nil)` + SwiftUI `ClayverConversationListView()` | `fun openConversations(context: Context)` + `@Composable ClayverConversationListScreen()` | `Future<void> openConversations()` |
| Open a new conversation | `@MainActor Clayver.openNewConversation(from: UIViewController? = nil)` | `fun openNewConversation(context: Context)` | `Future<void> openNewConversation()` |
| Start a conversation in code | `try await Clayver.startConversation(text:attachment:) -> ClayverMessage` | `suspend fun startConversation(text: String?, attachment: ClayverAttachmentInput? = null): ClayverMessage` | `Future<ClayverMessage> startConversation({String? text, ClayverAttachmentInput? attachment})` |
| Blocked state | `Clayver.blockStatus() -> AsyncThrowingStream<ClayverBlockStatus?, Error>` | `fun blockStatusFlow(): Flow<ClayverBlockStatus?>` | `Stream<ClayverBlockStatus?> blockStatus()` |
| Delete my data | `try await Clayver.deleteCustomerData()` | `suspend fun deleteCustomerData()` | `Future<void> deleteCustomerData()` |

`ClayverOptions` on every platform: `projectId` (workspace, default `"default"`),
`functionsRegion` (default `"us-central1"`), `databaseURL` (optional, for a
non-default RTDB instance), `firebaseApp` / app name (optional, default app),
`theme` (accent color, bubble colors, font), `useEmulator` (host/ports, debug only), `multipleConversations` (default `true`, see below),
`signInAnonymously` (default `true`, see below).

## Identity

Customers and agents are Firebase Auth users of the host app's Firebase project.
There is no Clayver-specific login and no extra backend:

- The host app signs users in with Firebase Auth as usual (any provider). The
  SDK follows the Firebase user (iOS `addStateDidChangeListener`, Android
  `AuthStateListener`): the customer id is the Firebase uid and push
  registrations move to the new uid. Android flows switch to the new user;
  iOS streams keep their customer id, so re-create them when the user changes.
- With no signed-in user the SDK signs in anonymously, so people can chat before
  they log in. Set `signInAnonymously: false` to require a signed-in user; SDK
  calls then fail with `notAuthenticated` until the host signs someone in.
- To keep the conversations of an anonymous user when they create an account,
  link the new credential to that user instead of creating a separate one
  (iOS `user.link(with:)`, Android `linkWithCredential`, Flutter
  `linkWithCredential`). The uid stays the same. Signing in to an existing
  account switches to that account's uid instead.
- **Signing out:** call `logout()` right before the host's `signOut()`. It
  removes this device's push registrations while the user can still write them.
  It signs out an anonymous user itself but never the host's own user.

The server records a read-only snapshot of the Firebase account under
`users/{cid}/account` (`anonymous`, `email`, `emailVerified`, `displayName`) so
agents can see who they are talking to.

## Multiple conversations

A customer can have any number of conversations. The SDK UIs work like this when
`ClayverOptions.multipleConversations` is `true` (the default):

- `openChat()` with no id opens the **conversation list** if the customer has
  at least one conversation, and a new, empty conversation otherwise.
  `openConversations()` always opens the list.
- The list shows every conversation from `inbox/{customerId}` newest first:
  the last message preview (or "Attachment"), its time, an unread badge, and a
  "Resolved" label for closed conversations. A **New conversation** button
  opens an empty chat. Tapping a row opens that conversation. Writing in a
  resolved conversation reopens it.
- An empty chat creates its conversation when the first message is sent
  (no empty conversations are ever written).
- `openChat(conversationId:)` and pushes open that conversation directly, with a
  back button to the list.
- `sendMessage(conversationId: nil)` keeps its meaning (latest open
  conversation, or a new one); `startConversation` always creates a new one.

With `multipleConversations: false`, `openChat()` opens the latest conversation
(or a new one) and there is no list, as before. `openConversations` and
`openNewConversation` still work, so a host app can build its own entry points.

**Blocked customers.** `blockStatus()` emits `ClayverBlockStatus { reason, until? }`
while `moderation/{customerId}` holds an active block, else `nil`/`null`. The
chat UI then replaces the composer with "You can't send messages right now."
and sends fail with `permissionDenied`.

**Deleting data.** `deleteCustomerData()` calls `clayverDeleteMyData`, which
erases everything stored for the current customer (see the data model), then
logs out. Call it from your app's account deletion flow.

## Errors

All async APIs throw a single error type with a stable code:
`notConfigured`, `notAuthenticated`, `permissionDenied`, `invalidArgument`,
`network`, `attachmentTooLarge`, `unsupportedAttachmentType`, `cancelled`,
`internal`. Flutter maps them to `ClayverException(code, message)` with the
same codes in lowerCamelCase strings.

## Cancellation

Swift: cancelling the calling `Task` cancels the operation and throws
`CancellationError`; streams stop their Firebase listeners in `onTermination`.
Kotlin: cancelling the coroutine cancels the operation (`CancellationException`
propagates); flows remove their listeners in `awaitClose`.

## Agent mode

When the signed-in Firebase user holds an agent or admin role for the
workspace, the same SDK can answer customers. The role is read from the verified
ID token claim `clayver_roles[projectId]`. Every agent operation is still
checked by the database rules, so calling these without a role fails with
`permissionDenied`.

| Capability | Swift | Kotlin | Dart |
| --- | --- | --- | --- |
| Role | `try await Clayver.agentRole(forceRefresh: Bool = false) -> ClayverAgentRole?` (`.admin`, `.agent`) | `suspend fun agentRole(forceRefresh: Boolean = false): ClayverAgentRole?` | `Future<ClayverAgentRole?> agentRole({bool forceRefresh = false})` |
| Is agent | `try await Clayver.isAgent() -> Bool` | `suspend fun isAgent(): Boolean` | `Future<bool> isAgent()` |
| Open agent inbox UI | `@MainActor Clayver.openAgentInbox(conversationId: String? = nil, from:)` + SwiftUI `ClayverAgentInboxView()` | `fun openAgentInbox(context, conversationId: String? = null)` + `@Composable ClayverAgentInboxScreen()` | `Future<void> openAgentInbox({String? conversationId})` |
| Inbox | `Clayver.agentConversations(status: .open, limit: 50, tagId: String? = nil)` -> AsyncThrowingStream<[ClayverAgentConversation], Error>` | `fun agentConversationsFlow(status: ClayverConversationStatus = OPEN, limit: Int = 50, tagId: String? = null)`: Flow<List<ClayverAgentConversation>>` | `Stream<List<ClayverAgentConversation>> agentConversations({status, limit, tagId})` |
| Customer profile | `Clayver.customerProfile(customerId:) -> AsyncThrowingStream<ClayverCustomerProfile, Error>` | `fun customerProfileFlow(customerId): Flow<ClayverCustomerProfile>` | `Stream<ClayverCustomerProfile> customerProfile(String customerId)` |
| Messages | same `messages(conversationId:)` / `loadOlderMessages` as customers | same | same |
| Reply | `try await Clayver.sendAgentReply(conversationId:text:attachment:) -> ClayverMessage` | `suspend fun sendAgentReply(conversationId, text, attachment = null): ClayverMessage` | `Future<ClayverMessage> sendAgentReply({required conversationId, text, attachment})` |
| Status | `try await Clayver.setConversationStatus(_ id:, _ status: .open/.closed)` | `suspend fun setConversationStatus(conversationId, status)` | `Future<void> setConversationStatus(String id, ClayverConversationStatus status)` |
| Assign | `try await Clayver.assignConversation(_ id:, toMe: Bool)` | `suspend fun assignConversation(conversationId, toMe: Boolean)` | `Future<void> assignConversation(String id, {required bool toMe})` |
| Tags | `Clayver.tags() -> AsyncThrowingStream<[ClayverTag], Error>` | `fun tagsFlow(): Flow<List<ClayverTag>>` | `Stream<List<ClayverTag>> tags()` |
| Create a tag | `try await Clayver.createTag(name: String, color: String? = nil) -> ClayverTag` | `suspend fun createTag(name: String, color: String? = null): ClayverTag` | `Future<ClayverTag> createTag(String name, {String? color})` |
| Conversation tags | `Clayver.conversationTags(conversationId:) -> AsyncThrowingStream<[String], Error>` (tag ids) | `fun conversationTagsFlow(conversationId): Flow<List<String>>` | `Stream<List<String>> conversationTags(String conversationId)` |
| Tag / untag | `try await Clayver.addTag(_ tagId:, to conversationId:)`, `removeTag(_:from:)` | `suspend fun addTag(conversationId, tagId)`, `removeTag(conversationId, tagId)` | `Future<void> addTag(String conversationId, String tagId)`, `removeTag(...)` |
| Mark read (team) | `try await Clayver.markConversationReadAsAgent(_ id:)` | `suspend fun markConversationReadAsAgent(conversationId)` | `Future<void> markConversationReadAsAgent(String id)` |

`ClayverAgentConversation`: `id, customerId, status, createdAt, updatedAt,
lastMessage, unreadForAgents (unread.agent), assigneeUid`.
`ClayverTag`: `id, name, color` (`#rrggbb`). `ClayverBlockStatus`: `reason` (`spam`,
`abuse`, `rateLimit`, `other`; unknown values map to `other`), `until` (optional date).

**Tags in the agent UI.** The agent conversation view shows the conversation's
tags as colored chips under the header, with an "Add tag" sheet that lists the
catalog, toggles tags, and creates a new tag from the search text when nothing
matches. The agent inbox has a tag filter row (All + every tag). `createTag`
derives the id from the name (slug rules in the data model), returns the
existing tag when that id exists, and picks the palette color by slug when
`color` is omitted. With `tagId`, `agentConversations` reads
`tagIndex/{tagId}` (same `statusOrder` range and limit) and then each
conversation.
`ClayverCustomerProfile`: `customerId, account, properties, lastSeenAt`, where
`ClayverCustomerAccount` is `anonymous, email?, emailVerified, displayName?`
(absent until the customer's first conversation).

Agent replies are written as `senderType: "agent"`, `senderId: auth.uid`,
`senderName` from `agents/{uid}/displayName`. Agent conversations are listed with
`orderByChild('statusOrder').startAt('{status}_').endAt('{status}_~').limitToLast(n)`.

**Push.** When the user is an agent, `setPushToken` / `setFCMToken` also
registers the token under `devices/agents/{uid}/{deviceId}`, and `logout`,
`clearPushToken` and losing the role remove it. Pushes with `audience: "agent"`
open the agent conversation view in `handleNotification`.

**Role changes.** Agents are Firebase Auth accounts granted a role by email or
uid. A fresh sign-in carries a fresh ID token, so a granted role applies as soon
as the agent signs in. `agentRole(forceRefresh: true)`
picks up grants made while the app is running.
