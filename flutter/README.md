# clayver (Flutter)

Flutter plugin for [Clayver](../README.md), open-source in-app customer support
whose backend (Realtime Database, Storage, Cloud Functions, FCM) runs in **your
own Firebase project**.

The plugin is a thin wrapper. Every call goes to the native SDKs:

| Platform | Native SDK | Bridge |
| --- | --- | --- |
| iOS 15+ | `ClayverSDK` (Swift package / CocoaPod), facade `Clayver` | `ios/Classes/ClayverPlugin.swift` |
| Android 6+ (API 23) | `com.clayver:clayver-android`, object `com.clayver.sdk.Clayver` | `android/src/main/kotlin/com/clayver/flutter/ClayverPlugin.kt` |

Messaging, push registration, unread counters and the chat UI are native. The
chat screens opened by `Clayver.openChat()`, `openConversations()` and
`openNewConversation()` are the native SwiftUI or Jetpack Compose screens, not
Flutter widgets.

## Install

Clayver needs the Firebase backend deployed first. See the
[setup guide](../README.md) (`npx clayver init` deploys the functions and the
database rules).

```yaml
dependencies:
  clayver: ^0.2.0
  firebase_core: ^5.0.0
  firebase_messaging: ^17.0.0 # for push notifications
```

Then configure Firebase for the app with the FlutterFire CLI:

```sh
dart pub global activate flutterfire_cli
flutterfire configure   # writes lib/firebase_options.dart and the native config files
```

### iOS setup

1. Minimum deployment target 15.0. In `ios/Podfile`: `platform :ios, '15.0'`.
2. Until `ClayverSDK` is published on CocoaPods trunk, point CocoaPods at the
   repository, inside `target 'Runner' do` and before `flutter_install_all_ios_pods`:

   ```ruby
   pod 'ClayverSDK', :podspec => 'https://raw.githubusercontent.com/clayver/clayver/v0.1.0/ios/ClayverSDK.podspec'
   # or, with a local checkout: pod 'ClayverSDK', :path => '<path to clayver>/ios'
   ```

   The podspec lives in `ios/`, not at the repository root, so a
   `:git => ...` pod source cannot find it; `:podspec` fetches that file and
   then checks out the matching `v0.1.0` tag. Once the pod is on trunk, drop
   this line: the plugin's podspec already depends on `ClayverSDK ~> 0.1.0`.

   The plugin supports CocoaPods only; with Swift Package Manager enabled
   Flutter still installs it through CocoaPods.
3. Push notifications (APNs):
   - In Xcode, *Runner → Signing & Capabilities*: add **Push Notifications**
     and **Background Modes → Remote notifications**.
   - Create an APNs **auth key** (.p8) in the Apple Developer portal and upload
     it in *Firebase console → Project settings → Cloud Messaging → Apple app
     configuration*.
   - Keep Firebase method swizzling on (the default). `firebase_messaging` then
     forwards the APNs device token to FCM, which is what makes
     `FirebaseMessaging.instance.getToken()` work on iOS.

### Android setup

1. `minSdk` 23 or higher.
2. Add the dependency source. Until `com.clayver:clayver-android` is on Maven
   Central, use one of the options in [Using a local native SDK](#using-a-local-native-sdk).
3. Android 13+ needs the `POST_NOTIFICATIONS` runtime permission. Add
   `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />` to
   `AndroidManifest.xml` and call `FirebaseMessaging.instance.requestPermission()`.
4. `openChat` starts the native chat Activity from your `FlutterActivity`; the
   Activity is declared by the native SDK, so no manifest entry is needed.

## Usage

```dart
import 'package:clayver/clayver.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  await Clayver.configure(
    options: const ClayverOptions(
      theme: ClayverTheme(accentColor: Color(0xFF4F46E5)),
    ),
  );
  runApp(const MyApp());
}

// Sign in with Firebase Auth as usual; Clayver follows the signed-in user
// (the customer id is the Firebase uid). Optional context for agents:
await FirebaseAuth.instance.signInWithEmailAndPassword(email: email, password: password);
await Clayver.setUserProperties({'name': user.name, 'plan': 'pro'});

// Push: the FCM registration token, on both platforms.
await FirebaseMessaging.instance.requestPermission();
final token = await FirebaseMessaging.instance.getToken();
if (token != null) await Clayver.setPushToken(token);
FirebaseMessaging.instance.onTokenRefresh.listen(Clayver.setPushToken);

// Notification taps.
FirebaseMessaging.onMessageOpenedApp.listen((m) => Clayver.handleNotification(m.data));
final initial = await FirebaseMessaging.instance.getInitialMessage();
if (initial != null) await Clayver.handleNotification(initial.data);

// Unread badge.
StreamBuilder<int>(
  stream: Clayver.unreadCountStream,
  builder: (context, snap) => Badge(
    isLabelVisible: (snap.data ?? 0) > 0,
    label: Text('${snap.data ?? 0}'),
    child: IconButton(icon: const Icon(Icons.support_agent), onPressed: Clayver.openChat),
  ),
);

// On sign-out: remove this device's push registration first, then sign out.
await Clayver.logout();
await FirebaseAuth.instance.signOut();
```

Customers are your app's Firebase Auth users; with nobody signed in the SDK
signs in anonymously. To keep an anonymous user's chats when they sign up, link
the new credential (`currentUser!.linkWithCredential(...)`) instead of creating
a new user. See [docs/identity.md](../docs/identity.md).

A runnable app is in [`examples/flutter`](../examples/flutter).

## API

All methods are static on `Clayver`. Every `Future` and `Stream` fails with a
`ClayverException`.

| Method | Description |
| --- | --- |
| `Future<void> configure({ClayverOptions? options})` | Initialize. Call once after `Firebase.initializeApp()`. |
| `Future<void> logout()` | Remove this device's push registration. Call it right before `FirebaseAuth.instance.signOut()`. Signs out an anonymous user itself. |
| `Future<void> setUserProperties(Map<String, Object> properties)` | Values: `String`, `int`, `double`, `bool`. Keys: `Clayver.userProperty.name`/`email`/`uid`, or `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. |
| `Future<void> setPushToken(String token)` | FCM registration token (both platforms). |
| `Future<void> clearPushToken()` | Deactivate this device's registration. |
| `Future<int> getUnreadMessagesCount()` | Current unread total. |
| `Stream<int> get unreadCountStream` | Live unread total. |
| `Future<void> openChat({String? conversationId})` | Open the native chat UI (see [Multiple conversations](#multiple-conversations)). |
| `Future<void> openConversations()` | Open the native conversation list. |
| `Future<void> openNewConversation()` | Open a new, empty chat; the conversation is created by its first message. |
| `Future<bool> handleNotification(Map<String, dynamic> data)` | Open the conversation of a tapped Clayver push; `false` if not a Clayver push. |
| `bool isClayverNotification(Map<String, dynamic> data)` | Synchronous payload check (`data['clayver'] == '1'`). |
| `Stream<List<ClayverConversation>> conversations()` | Live conversation list, newest first. |
| `Stream<List<ClayverMessage>> messages(String conversationId)` | Live newest page of messages, oldest first. |
| `Future<List<ClayverMessage>> loadOlderMessages(String conversationId, {required String before, int limit = 30})` | History before a message id. |
| `Future<ClayverMessage> sendMessage({String? text, String? conversationId, ClayverAttachmentInput? attachment})` | Send as the customer. Without `conversationId` the open conversation is reused or a new one is created. |
| `Future<ClayverMessage> startConversation({String? text, ClayverAttachmentInput? attachment})` | Send the first message of a **new** conversation, even when one is open. The message carries the new `conversationId`. |
| `Future<void> markConversationRead(String id)` | Mark read (read receipt + unread counters). |
| `Stream<ClayverBlockStatus?> blockStatus()` | `ClayverBlockStatus(reason, until)` while the customer is blocked, else `null`. |
| `Future<void> deleteCustomerData()` | Erase everything stored for the customer (`clayverDeleteMyData`), then log out. |

Attachments are photos only. Pass an image (`ClayverAttachmentInput.file` or
`.bytes`, content type `image/jpeg`, `image/png`, `image/gif`, `image/webp` or
`image/heic`); the native SDK compresses it client-side to a JPEG of at most
300 KB (`ClayverAttachmentInput.maxBytes`) before uploading. Other content
types fail with `unsupportedAttachmentType`, and an image that cannot be
compressed under the limit fails with `attachmentTooLarge`. The native chat UI
offers photo attachments only (no generic file picker).

### Multiple conversations

A customer can have any number of conversations. With
`ClayverOptions.multipleConversations: true` (the default):

- `openChat()` without an id opens the **conversation list** if the customer
  has a conversation, and a new empty chat otherwise. `openConversations()`
  always opens the list, which shows every conversation newest first (preview,
  time, unread badge, "Resolved" for closed ones) and a **New conversation**
  button.
- An empty chat creates its conversation when the first message is sent.
- `openChat(conversationId: ...)` and notification taps open that conversation
  directly, with a back button to the list.
- `sendMessage()` without `conversationId` still goes to the latest open
  conversation (or a new one); `startConversation()` always creates a new one.

With `multipleConversations: false`, `openChat()` opens the latest
conversation (or a new one) and there is no list. `openConversations()` and
`openNewConversation()` still work, so you can build your own entry points.

```dart
await Clayver.configure(options: const ClayverOptions(multipleConversations: true));

TextButton(onPressed: Clayver.openConversations, child: const Text('My conversations'));
TextButton(onPressed: Clayver.openNewConversation, child: const Text('New conversation'));
```

**Blocked customers.** `blockStatus()` emits a `ClayverBlockStatus` while an
agent block is active (`reason` is `spam`, `abuse`, `rateLimit` or `other`;
unknown values map to `other`; `until` is the end time, or `null` until an
agent lifts it), and `null` otherwise. A timed block turns into `null` by
itself. While blocked, the native chat replaces the composer with a notice and
sends fail with `permissionDenied`.

```dart
StreamBuilder<ClayverBlockStatus?>(
  stream: Clayver.blockStatus(),
  builder: (context, snap) => snap.data == null
      ? const SizedBox.shrink()
      : const Text("You can't send messages right now."),
);
```

**Deleting data.** Call `deleteCustomerData()` from your app's account
deletion flow. It calls the `clayverDeleteMyData` function, which erases the
customer's conversations, messages, attachments, profile and push
registrations, then logs out.

### Agent mode

When the signed-in user holds an agent or admin role for the workspace (the
ID token claim `clayver_roles[projectId]`, read natively), the same
plugin can answer customers. The role only decides what the app shows; the
database rules check every agent operation, so calling these without a role
fails with `permissionDenied`. Roles are granted from the dashboard, the CLI
(`clayver admin grant`) or `clayverSetAgentRole`, to a Firebase account by email
or uid.

| Method | Description |
| --- | --- |
| `Future<ClayverAgentRole?> agentRole({bool forceRefresh = false})` | `admin`, `agent`, or `null` for customers. `forceRefresh` picks up grants made while the app runs. |
| `Future<bool> isAgent()` | Whether to show agent features. |
| `Future<void> openAgentInbox({String? conversationId})` | Open the native agent inbox, optionally on a conversation. |
| `Stream<List<ClayverAgentConversation>> agentConversations({ClayverConversationStatus status = open, int limit = 50, String? tagId})` | Live workspace inbox, newest activity first; with `tagId`, only conversations with that tag. |
| `Stream<ClayverCustomerProfile> customerProfile(String customerId)` | Live customer record (`account`, `properties`, `lastSeenAt`, `displayName`). |
| `Future<ClayverMessage> sendAgentReply({required String conversationId, String? text, ClayverAttachmentInput? attachment})` | Reply as the signed-in agent. |
| `Future<void> setConversationStatus(String id, ClayverConversationStatus status)` | Open or close (`unknown` is rejected with `invalidArgument`). |
| `Future<void> assignConversation(String id, {required bool toMe})` | Assign to me or unassign. |
| `Future<void> markConversationReadAsAgent(String id)` | Move the team's read marker. |
| `Stream<List<ClayverTag>> tags()` | Live tag catalog (`id`, `name`, `color` as `#rrggbb`), by name. |
| `Future<ClayverTag> createTag(String name, {String? color})` | Create a tag whose id is the slug of `name`, or return the existing one. Without `color` a palette color is picked from the slug. |
| `Stream<List<String>> conversationTags(String conversationId)` | Live tag ids of a conversation. |
| `Future<void> addTag(String conversationId, String tagId)` | Tag a conversation (the tag must exist). |
| `Future<void> removeTag(String conversationId, String tagId)` | Untag a conversation. |

Agents read messages with the same `messages()` / `loadOlderMessages()`.
`handleNotification` opens the agent inbox on the conversation for pushes with
`audience: "agent"` (routing is done by the native SDK), and `setPushToken`
also registers an agent device when the user is an agent.

```dart
if (await Clayver.isAgent()) {
  await Clayver.openAgentInbox();
}

// Tags.
final ClayverTag billing = await Clayver.createTag('Billing');
await Clayver.addTag(conversationId, billing.id);
Clayver.agentConversations(tagId: billing.id).listen(showBillingInbox);
```

The native agent UI already shows a conversation's tags as chips, with an
"Add tag" sheet, and the inbox has a tag filter row.

Streams share one native listener between all Dart listeners and replay the
latest value to late listeners. The native listener is removed when the last
Dart subscription is cancelled.

`ClayverOptions`: `projectId` (default `default`), `functionsRegion` (default
`us-central1`), `databaseURL`, `firebaseAppName` (name given to
`Firebase.initializeApp(name: ...)`), `theme`, `emulator`,
`multipleConversations` (default `true`), `signInAnonymously` (default
`true`; with `false`, calls fail with `notAuthenticated` until the app signs a
user in).

`ClayverTheme`: `title`, `accentColor`, `customerBubbleColor`,
`customerTextColor`, `agentBubbleColor`, `agentTextColor`, `fontFamily`.

### Errors

`ClayverException.code` is one of `ClayverErrorCode`:
`notConfigured`, `notAuthenticated`, `permissionDenied`, `invalidArgument`,
`network`, `attachmentTooLarge`, `unsupportedAttachmentType`, `cancelled`,
`internal`. The codes are the same strings as the native SDKs' error codes.
`message` is for logs, not for display logic.

```dart
try {
  await Clayver.sendMessage(text: 'Hi');
} on ClayverException catch (e) {
  if (e.code == ClayverErrorCode.network) { /* retry later */ }
}
```

## Platform-specific behavior

These differences come from the platforms and the native SDKs and cannot be
hidden by the plugin.

- **Push token.** Pass the **FCM** token on both platforms. On iOS the plugin
  calls `Clayver.setFCMToken(_:)`; the native APNs-token API
  (`setPushToken(Data)`) is not exposed. iOS only issues an FCM token after APNs
  has delivered the device token to Firebase (method swizzling, on by default
  with `firebase_messaging`). On the simulator, or without the Push
  Notifications capability, `getAPNSToken()` stays `null` and `getToken()` fails.
- **FCM registration tokens.** Clayver stores FCM *registration tokens*.
  `firebase_messaging` 17 marks `getToken()`/`onTokenRefresh` deprecated in
  favor of `register()`/`onRegistered`, which report a Firebase Installation ID
  for FCM direct-send. Keep using `getToken()` (with
  `// ignore: deprecated_member_use`) until Clayver supports installation IDs.
- **Notification permission.** iOS always asks. Android asks only on
  Android 13+ (API 33) and only if `POST_NOTIFICATIONS` is in the manifest;
  older Android versions grant it at install time.
- **`openChat` presentation** (also `openConversations`, `openNewConversation`,
  `openAgentInbox`). iOS presents the SwiftUI chat **modally** over the
  top-most view controller (the `FlutterViewController` or whatever it is
  presenting); swipe down or *Done* dismisses it. Android starts a separate
  **Activity** from the Activity the plugin is attached to; Back returns to
  Flutter. On Android, calling these while the engine has no Activity
  (for example from a background isolate) fails with `internal`.
- **Foreground notifications.** iOS shows Clayver pushes in the foreground only
  if you call `FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(alert: true, ...)`.
  On Android, FCM never displays notification messages while the app is in the
  foreground; `onMessage` fires instead (the native SDK's
  `Clayver.onMessageReceived` is not called, because `firebase_messaging` owns
  the `FirebaseMessagingService`). Use `unreadCountStream` to surface new
  messages, or show a local notification yourself.
- **Background messages.** Clayver pushes contain a `notification` block, so the
  OS displays them while the app is in the background or terminated; no Dart
  code runs for them. If you register `FirebaseMessaging.onBackgroundMessage`,
  that handler runs in a separate isolate: only the synchronous
  `Clayver.isClayverNotification` is safe to use there. Do not call `openChat`
  or other APIs from it.
- **Notification taps.** Forward `onMessageOpenedApp` and `getInitialMessage()`
  data to `handleNotification`. On iOS a tap during a cold start is remembered
  by the native SDK and the chat opens once `configure` completes.
- **One push handler on Android.** `firebase_messaging` registers its own
  `FirebaseMessagingService`. Android delivers each message to a single
  service, so keep `firebase_messaging` as the handler; Clayver notifications are
  displayed by the system from their `notification` block.
- **Theme fonts.** `ClayverTheme.fontFamily` names a font of the **native** app
  (iOS: a font registered in `Info.plist`, applied with Dynamic Type scaling;
  Android: a font resource name in `res/font`). Flutter asset fonts are not
  visible to the native UI.
- **Cancellation.** Cancelling a Dart stream subscription cancels the native
  `Task` (iOS) or coroutine (Android). In-flight `Future` calls cannot be
  cancelled from Dart; on Android they are cancelled with code `cancelled` when
  the Flutter engine detaches.

## Using a local native SDK

For development against this repository (or before the artifacts are
published):

**iOS**: `pod 'ClayverSDK', :path => '<clayver>/ios'` in the app's Podfile
(the path is the folder that contains `ClayverSDK.podspec`).

**Android**, option A, Gradle composite build (no publishing). In the app's
`android/settings.gradle.kts`:

```kotlin
includeBuild("<clayver>/android") {
    dependencySubstitution {
        substitute(module("com.clayver:clayver-android")).using(project(":clayver"))
    }
}
```

**Android**, option B, Maven local: publish the SDK with
`./gradlew :clayver:publishToMavenLocal` in `<clayver>/android`, then add
`mavenLocal()` to `allprojects { repositories { ... } }` in the app's
`android/build.gradle.kts`. To use another version than the plugin's default,
set `clayver.androidSdkVersion=<version>` in the app's `android/gradle.properties`.

## Development

```sh
cd flutter
flutter pub get
dart run pigeon --input pigeons/clayver_api.dart   # regenerate the bridge
flutter analyze
flutter test
```

`pigeons/clayver_api.dart` is the single definition of the bridge; the generated
`lib/src/messages.g.dart`, `ios/Classes/Messages.g.swift` and
`android/src/main/kotlin/com/clayver/flutter/Messages.g.kt` are committed and
must not be edited by hand.
