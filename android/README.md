# Clayver Android SDK

In-app customer support for Android, running entirely in **your own Firebase
project** (Realtime Database, Cloud Storage, Cloud Functions, FCM). Kotlin,
coroutines and Jetpack Compose; minSdk 23.

The data paths and payloads the SDK uses are defined in
[`firebase/database.schema.md`](../firebase/database.schema.md); the
cross-platform API contract is [`docs/sdk-api.md`](../docs/sdk-api.md).

## Install

The module is `android/clayver` (package `com.clayver.sdk`, Maven coordinates
`com.clayver:clayver-android`). Until it is published to a public repository, use one of:

- **Composite build** (what `examples/android` does):
  ```kotlin
  // settings.gradle.kts
  includeBuild("path/to/clayver/android")
  // app/build.gradle.kts
  dependencies { implementation("com.clayver:clayver-android:0.1.1") }
  ```
- **Maven local**: `cd android && ./gradlew :clayver:publishToMavenLocal`, add
  `mavenLocal()` to your repositories, then depend on `com.clayver:clayver-android:0.1.1`.

The SDK brings the Firebase BoM (auth, database, storage, functions, messaging),
Compose Material 3 and Coil. Your app still needs the
`com.google.gms.google-services` plugin and its `google-services.json`, or an
explicitly initialised `FirebaseApp`.

### Firebase project prerequisites

1. Deploy the Clayver rules and functions with the Clayver CLI.
2. Enable **Anonymous** sign-in (Authentication → Sign-in method). The SDK signs
   in anonymously when your app has no Firebase user.
3. Register your Android app in the Firebase console and add `google-services.json`.

## Quick start

```kotlin
class MyApp : Application() {
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate() {
        super.onCreate()
        appScope.launch {
            Clayver.configure(this@MyApp, ClayverOptions(projectId = "default"))
            Clayver.setPushToken(FirebaseMessaging.getInstance().token.await())
        }
    }
}

// Sign users in with Firebase Auth as usual; Clayver follows the signed-in user.
// Optional context for agents:
Clayver.setUserProperties(mapOf("name" to user.name, "plan" to "pro"))

// Signing out: remove this device's push registration first
Clayver.logout()
FirebaseAuth.getInstance().signOut()

// Support button
Clayver.openChat(context)                 // ClayverChatActivity: the conversation list, or a new chat over it
val unread by Clayver.unreadCountFlow().collectAsStateWithLifecycle(0)

// Or embed the UI in your own Compose screen
ClayverConversationListScreen(onClose = { navController.popBackStack() })
ClayverChatScreen(onClose = { navController.popBackStack() })
```

Calls made while `configure` is still running wait for it; calls before any
`configure` throw `ClayverException(NOT_CONFIGURED)`.

## Push notifications (FCM)

Clayver pushes are FCM messages with a `notification` and a `data` block whose
`clayver` field is `"1"` (schema: *Push notification payload*).

**1. Token registration.** Register the token after `configure` and on every
refresh. The SDK writes it to
`devices/customers/{cid}/{deviceId}` and moves it automatically when the
Firebase user changes; `logout()` removes it.

**2. Receiving.** Either declare the SDK's service (if your app has none):

```xml
<service android:name="com.clayver.sdk.ClayverMessagingService" android:exported="false">
  <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter>
</service>
```

or delegate from your own `FirebaseMessagingService`:

```kotlin
override fun onNewToken(token: String) {
    Clayver.onNewToken(applicationContext, token)
}
override fun onMessageReceived(message: RemoteMessage) {
    if (Clayver.onMessageReceived(applicationContext, message)) return
    // your own pushes
}
```

While the app is in the foreground, `onMessageReceived` shows the notification
on the `clayver_messages` channel ("Support messages", importance high) with a
`PendingIntent` that opens `ClayverChatActivity` on that conversation, on top of
your launcher activity. It is skipped when that conversation is already on
screen. Customise the icon, colour and channel with
`ClayverOptions(notifications = ClayverNotificationOptions(smallIcon = R.drawable.ic_stat_support))`.

**3. Background taps.** When the app is in the background, Android shows the
notification itself and a tap starts your **launcher activity** with the data
block as extras. Forward it:

```kotlin
override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (savedInstanceState == null) Clayver.handleIntent(this, intent)
}
override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    Clayver.handleIntent(this, intent)
}
```

`Clayver.isClayverNotification(data)` and `Clayver.handleNotification(context, data)`
work on a plain `Map<String, String>` if you route pushes yourself.

**4. Android 13+.** The library manifest declares `POST_NOTIFICATIONS`, but
your app must request it at runtime (see `examples/android/.../MainActivity.kt`).
Without it the SDK silently skips showing notifications; unread counts still work.
While notifications are off, the customer chat shows a dismissible banner: on
Android 13+ it requests `POST_NOTIFICATIONS` while the system can still ask, and
once it can't (permanently denied, or notifications turned off in Settings) it
shows a dialog with an **Open settings** button for the app's notification
settings. It is re-checked on resume. Turn it off with
`ClayverOptions(showNotificationPrompt = false)` if you handle the permission yourself.
Clayver uses the default FCM notification channel for background pushes unless
you set `com.google.firebase.messaging.default_notification_channel_id` to
`clayver_messages` in your manifest.

## Identity

Customers and agents are Firebase Auth users of your app's Firebase project.
The SDK follows the signed-in user with an `AuthStateListener`: the customer id
(`cid`) is the Firebase uid, flows switch to the new user, and the push
registration moves to the new uid. There is no secret and no extra backend.

- **Anonymous visitors.** With nobody signed in, `configure` signs in
  anonymously so people can chat before they log in. Pass
  `ClayverOptions(signInAnonymously = false)` to require a signed-in user; calls
  then fail with `NOT_AUTHENTICATED` until your app signs someone in.
- **Keeping chats on sign-up.** Link the new credential to the anonymous user
  (`auth.currentUser!!.linkWithCredential(credential)`) instead of creating a
  separate account; the uid, and so the conversations, stay the same.
- **Signing out.** Call `Clayver.logout()` right before
  `FirebaseAuth.signOut()`. It removes this device's push registrations while
  the user can still write them. It signs out an anonymous user itself; your own
  signed-in user stays signed in until you sign it out.

See [docs/identity.md](../docs/identity.md).

## API reference

All suspend functions throw `ClayverException` (see *Errors*) and honour
coroutine cancellation. All flows remove their Firebase listeners when the
collector is cancelled.

| API | Notes |
| --- | --- |
| `suspend fun configure(context, options = ClayverOptions())` | Connects to Firebase, signs in anonymously if needed (unless `signInAnonymously = false`), starts following Firebase Auth, creates the per-install `deviceId` (SharedPreferences). |
| `suspend fun logout()` | See *Identity*. |
| `suspend fun setUserProperties(Map<String, Any>)` | Keys: `Clayver.UserProperty.NAME`/`EMAIL`/`UID`, or `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`; values: String ≤ 1000, number, boolean. |
| `suspend fun setPushToken(token)` / `clearPushToken()` | FCM registration for this device. |
| `fun onNewToken(context, token)` / `fun onMessageReceived(context, message): Boolean` | FCM service delegation. |
| `fun isClayverNotification(data)` / `fun handleNotification(context, data): Boolean` / `fun handleIntent(context, intent): Boolean` | Push recognition and deep link (`clayver://conversation/{id}`). |
| `suspend fun getUnreadMessagesCount(): Int` / `fun unreadCountFlow(): Flow<Int>` | `inbox/{cid}/unreadTotal`; the flow follows identity changes. |
| `fun conversationsFlow(): Flow<List<ClayverConversation>>` | Newest first. |
| `fun messagesFlow(conversationId, limit = 30)` + `suspend fun loadOlderMessages(conversationId, beforeMessageId, limit = 30)` | `orderByKey().limitToLast(n)` and `.endBefore(oldestKey)`. Oldest first. |
| `suspend fun sendMessage(text, conversationId = null, attachment = null): ClayverMessage` | Without an id: the open conversation, created if none. Text 1..4000 chars. |
| `suspend fun startConversation(text, attachment = null): ClayverMessage` | Always creates a new conversation with this first message (the attachment is uploaded before the conversation is written). |
| `suspend fun markConversationRead(conversationId)` | Writes `reads/{id}/customer/lastReadAt`. |
| `fun blockStatusFlow(): Flow<ClayverBlockStatus?>` | `moderation/{cid}` while a block is active (`blocked == true` and `until` absent or in the future), else null; emits null by itself when `until` passes. `reason`: `SPAM`, `ABUSE`, `RATE_LIMIT`, `OTHER`. |
| `suspend fun deleteCustomerData()` | Callable `clayverDeleteMyData({projectId})` erases everything stored for the customer, then `logout()`. Use it in your account deletion flow. |
| `fun openChat(context, conversationId = null)` / `@Composable ClayverChatScreen(...)` | Built-in UI, see *Multiple conversations*. |
| `fun openConversations(context)` / `@Composable ClayverConversationListScreen(...)` | The customer's conversation list. |
| `fun openNewConversation(context)` | A new, empty chat (`ClayverChatScreen(newConversation = true)` in Compose). |

`ClayverOptions`: `projectId` (`"default"`), `functionsRegion` (`"us-central1"`),
`databaseURL`, `firebaseApp` / `firebaseAppName`, `theme`, `emulator`
(`ClayverEmulator(host, ports)`, debug only), `notifications`,
`multipleConversations` (`true`), `signInAnonymously` (`true`),
`showNotificationPrompt` (`true`, the chat's notification-permission banner).

### Multiple conversations

With `multipleConversations = true` (the default), `openChat(context)` opens the
conversation list when the customer has at least one conversation, and a new,
empty chat over the list otherwise. The list shows every conversation newest first (last
message or "Attachment", time, unread badge) and a
**New conversation** button. `openChat(context, id)` and pushes open that
conversation over the list. A chat over the list has a back button (top left)
that leads to the list; every screen has a close button (top right) that closes
the whole support UI. An empty chat creates its
conversation only when the first message is sent. Customers are never shown
that the team closed a conversation; writing in a closed one reopens it.

With `multipleConversations = false`, `openChat` opens the latest open
conversation (or a new one) without a list, as in earlier versions;
`openConversations` and `openNewConversation` still work for your own entry points.

`ClayverConversationListScreen` navigates to the chat by itself; pass both
`onOpenConversation` and `onNewConversation` to use your own navigation, showing
`ClayverChatScreen(conversationId = id, onBack = ...)` or
`ClayverChatScreen(newConversation = true, onBack = ...)`.

While `blockStatusFlow()` reports a block, the chat replaces the composer with
"You can't send messages right now." (sends would fail with `PERMISSION_DENIED`).

### Attachments (photos only)

```kotlin
val input = ClayverAttachmentInput.fromUri(context, uri)          // Photo Picker result (images only)
// or ClayverAttachmentInput.fromBytes(bytes, "screenshot.png", "image/png")
Clayver.sendMessage(text = "Screenshot attached", attachment = input)
```

Only images are accepted: `image/jpeg`, `image/png`, `image/gif`, `image/webp`,
`image/heic` (HEIC decodes on API 28+); other types fail with
`UNSUPPORTED_ATTACHMENT_TYPE`. Before uploading, the SDK re-encodes every image
as a JPEG of at most 300 KB: it downscales so the longest side is at most
1600 px, applies the EXIF orientation (API 24+), steps the JPEG quality down
(85, 75, 65, ...) and keeps shrinking until the file fits. This happens off the
main thread, in `fromUri` (so the composer shows the final size) and otherwise
in `sendMessage` / `startConversation` / `sendAgentReply`, so programmatic
callers can pass raw image bytes (up to 30 MiB). The stored attachment is always
`image/jpeg` with a `.jpg` name, and its `size`, `width` and `height` describe
the compressed file. Files are uploaded to
`clayver/projects/{projectId}/customers/{cid}/conversations/{conversationId}/{attachmentId}/{fileName}`.

### Errors

`ClayverException.code` is a `ClayverErrorCode`; `code.wireName` is the
cross-platform string.

| Code | Typical cause |
| --- | --- |
| `NOT_CONFIGURED` | `configure` not called, or no Firebase app / `google-services.json`. |
| `NOT_AUTHENTICATED` | No Firebase user, expired/invalid token, Firebase Auth error. |
| `PERMISSION_DENIED` | Security rules denied the operation. |
| `INVALID_ARGUMENT` | Bad property key/value, empty or too-long text, bad ids. |
| `NETWORK` | Offline, Firebase unavailable, upload retry limit. |
| `ATTACHMENT_TOO_LARGE` / `UNSUPPORTED_ATTACHMENT_TYPE` | Attachment validation. |
| `CANCELLED` | Firebase reported the operation cancelled (coroutine cancellation is rethrown as-is). |
| `INTERNAL` | Anything else. |

## Chat UI

`ClayverChatScreen` (and `ClayverChatActivity`) provide real-time messages,
history that loads older pages when scrolled to the top, day headers and
timestamps, a "New messages" divider, "Seen" receipts from the agents' read
marker, photo attachments (Coil) via the Photo Picker, compressed to a JPEG of
at most 300 KB before upload, optimistic sending with retry, and loading/error/empty states with
retry. All elements have TalkBack descriptions; failed messages expose
*Retry*/*Delete* accessibility actions and new agent messages are announced.

Theme it with `ClayverTheme`:

```kotlin
ClayverOptions(
    theme = ClayverTheme(
        title = "Acme Support",
        lightColors = ClayverColors.light(accent = Color(0xFF0F766E)),
        darkColors = ClayverColors.dark(accent = Color(0xFF5EEAD4)),
        typography = ClayverTypography(fontFamily = myFontFamily),
        darkMode = ClayverDarkMode.SYSTEM,
    ),
)
```

If you keep the default accent, the workspace's `config/public/accentColor`
is used. The title defaults to the workspace's `teamName`, then "Support".
Strings are Android resources prefixed `clayver_`; override them in your app to
localise.

## Agent mode

Support staff can answer customers from the same app that embeds the SDK, in
addition to the web dashboard. A user is an agent when the ID token
carries `clayver_roles[projectId] = "agent" | "admin"`. Agents are Firebase
accounts your app signs in; grant the role by email or uid, like dashboard
agents (`clayver admin grant --email <email> --role agent`). The SDK only uses
the claim to decide what to show and to fail fast; the database rules check
`agents/{uid}/active` on every read and write.

```kotlin
if (Clayver.isAgent()) {                       // agentRole(): ClayverAgentRole.ADMIN / AGENT / null
    Clayver.openAgentInbox(context)            // ClayverAgentInboxActivity (declared in the library manifest)
}
// or in Compose
ClayverAgentInboxScreen(onClose = { navController.popBackStack() })
ClayverAgentConversationScreen(conversationId, onBack = { ... }, onOpenConversation = { id -> ... })   // with your own navigation
```

| API | Notes |
| --- | --- |
| `suspend fun agentRole(forceRefresh = false): ClayverAgentRole?` / `suspend fun isAgent()` | From `getIdToken(forceRefresh).claims["clayver_roles"][projectId]`. Use `forceRefresh = true` to pick up a grant made while the app runs. |
| `fun agentConversationsFlow(status = OPEN, limit = 50, tagId = null): Flow<List<ClayverAgentConversation>>` | `orderByChild("statusOrder").startAt("{status}_").endAt("{status}_~").limitToLast(limit)`, newest first. With `tagId`: `tagIndex/{tagId}.orderByValue()` over the same range, then a live listener per conversation. |
| `fun customerProfileFlow(customerId): Flow<ClayverCustomerProfile>` | `users/{cid}`: `account` (`ClayverCustomerAccount`: `anonymous`, `email`, `emailVerified`, `displayName`), `properties` (`name`, `email` helpers), `lastSeenAt`. |
| `messagesFlow` / `loadOlderMessages` | Same as for customers. |
| `suspend fun sendAgentReply(conversationId, text, attachment = null): ClayverMessage` | `senderType "agent"`, `senderId = auth.uid`, `senderName` from `agents/{uid}/displayName` (then the Firebase display name, then the e-mail's local part). Attachments go under the conversation's customer storage path. |
| `suspend fun setConversationStatus(conversationId, OPEN / CLOSED)` | Writes `conversations/{id}/status`. |
| `suspend fun assignConversation(conversationId, toMe)` | Sets `assigneeUid` to your uid, or removes it. |
| `suspend fun markConversationReadAsAgent(conversationId)` | Writes the shared team marker `reads/{id}/agent {lastReadAt, uid}`. |
| `fun tagsFlow(): Flow<List<ClayverTag>>` | The workspace catalog `tags/` (`id`, `name`, `color` `#rrggbb`), sorted by name. |
| `suspend fun createTag(name, color = null): ClayverTag` | Id = slug of the name (lowercase, accents stripped, other characters to `-`, ≤ 40); returns the existing tag when that id exists. Without `color`, the palette color picked by the slug. |
| `fun conversationTagsFlow(conversationId): Flow<List<String>>` | Tag ids in `conversationTags/{id}`. |
| `suspend fun addTag(conversationId, tagId)` / `removeTag(conversationId, tagId)` | Sets `conversationTags/{id}/{tagId} = true`, or removes it. |
| `fun triageOptionsFlow(): Flow<ClayverTriageOptions>` | `triageOptions/{priority,stage}` (`ClayverTriageOption`: `id`, `name`, `color`, `order`), sorted by `order`. A list never saved uses the defaults (`high`/`medium`/`low`; `todo`/`in_progress`/`on_hold`). |
| `fun triageFlow(conversationId): Flow<ClayverTriage>` | `triage/{id}` (`priority`, `stage` option ids). Agents only; customers never see it. A value missing from the list shows as none. |
| `suspend fun setConversationPriority(conversationId, optionId?)` / `setConversationStage(conversationId, optionId?)` | Sets `triage/{id}/priority` or `stage` ("Status" in the UI), or removes it when `null`. Independent of open/closed. |
| `fun notesFlow(conversationId): Flow<List<ClayverNote>>` | Internal notes `notes/{id}`, newest first. |
| `suspend fun addNote(conversationId, text): ClayverNote` / `deleteNote(conversationId, noteId)` | `{authorUid, authorName?, text (1..4000), createdAt}`; immutable; the author or an admin deletes. |
| `fun customerConversationsFlow(customerId, limit = 50)` | The customer's conversations (`orderByChild("customerId").equalTo(...)`), newest first. |
| `fun customerBlockStatusFlow(customerId)` / `suspend fun blockCustomer(customerId, reason, until = null)` / `unblockCustomer(customerId)` | `moderation/{customerId}`; `reason` is `SPAM`, `ABUSE` or `OTHER`, `until` in ms (null = until unblocked). |
| `fun teamFlow(): Flow<List<ClayverTeammate>>` | `agents/`, sorted by name (used for the assignee's name). |
| `fun openAgentInbox(context, conversationId = null)` | Opens the inbox, optionally on a conversation. |

Every agent API throws `PERMISSION_DENIED` right away when the token has no
role for the workspace.

**Built-in UI.** `ClayverAgentInboxScreen` has *Open* / *Closed* tabs; each row
shows the customer (`Clayver.UserProperty.NAME`, else the account's name or email, else
"Customer" + a short id), the last message, a relative time, the unread badge
(`unread.agent`) and whether the conversation is assigned to you or a teammate,
with loading, empty, error and "no agent access" states. The conversation view
shows the messages from the team's side (your replies and teammates' on the
right, named), loads older history, has the same composer with photo attachments,
shows "Seen" from the customer's read marker. The ⋮ button opens the *Details*
sheet: the customer (name, email, account, id, last seen, properties); the
conversation (assignee with *Assign to me* / *Unassign*, *Close* / *Reopen*,
*Priority* and *Status* pickers, tags); internal notes (add, delete your own,
admins any); the customer's conversations (the current one marked, others
open when navigation allows); and *Block* (reason and duration) / *Unblock*.
Priority, status and tags appear as colored chips under the header; *Add tag*
opens a sheet to search the catalog, toggle tags and create a new tag from the search text. The
inbox has a tag filter row (*All* plus every tag). While it is on screen
it moves `reads/{id}/agent`, which resets the team's unread counter. It uses
the same `ClayverTheme` and TalkBack semantics as the customer chat.

**Push.** When the user is an agent, `setPushToken` / `onNewToken` (and the
re-registration after `configure`, a sign-in and `agentRole(forceRefresh = true)`)
also write `devices/agents/{uid}/{deviceId}` with `platform: "android"`.
`clearPushToken()`, `logout()` and losing the role remove it. Pushes with
`audience: "agent"` are shown on their own channel, `clayver_agent_messages`
("Customer messages"; change it with `ClayverNotificationOptions(agentChannelId, agentChannelName)`),
and `onMessageReceived` / `handleNotification` / `handleIntent` open the agent
conversation view instead of the customer chat. A notification is skipped while
that conversation is on screen in the matching view.

## Platform notes

- **Threading.** Public APIs are main-safe; Firebase callbacks arrive on the
  main thread. Attachment reading happens on `Dispatchers.IO` and image
  compression on `Dispatchers.Default`.
- **Offline.** Realtime Database queues writes while offline; `sendMessage`
  suspends until the server acknowledges the write (the UI shows "Sending…").
  Disk persistence is not enabled by the SDK.
- **Cancellation.** Cancelling a coroutine cancels a running attachment upload.
  Database writes that were already handed to Firebase may still complete.
- **Duplicate conversations.** Sends without a `conversationId` are serialised
  per process, and the conversation just created is reused until the
  `inbox` index (written by the function) catches up.
- **Photo Picker** is backported to API 23–29 through Google Play services
  (declared in the library manifest); without it the system picker is used, still limited to images.
- **ProGuard/R8.** No rules needed beyond the bundled consumer rules: snapshots
  are read as maps, not reflected into classes.

## Development

```
cd android
./gradlew :clayver:testDebugUnitTest
```

Unit tests (JUnit 4 + kotlinx-coroutines-test) cover customer-id derivation,
property validation, push payload parsing and audience routing, error mapping,
attachment rules, snapshot parsing (including agent conversations and customer
profiles), role parsing from token claims, tag slugs and colors, triage lists, notes and team parsing, block
activity, conversation list rows and list-vs-chat routing, list formatting, the chat state
machine (`ChatController`, behind `ChatViewModel`) and the agent inbox and
conversation state machines (`AgentInboxController`,
`AgentConversationController`) against fake repositories. That logic is kept
free of Android and Firebase types for that reason.
