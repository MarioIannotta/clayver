# Clayver Android example

A minimal Compose app that shows the whole integration:

| File | Shows |
| --- | --- |
| `ExampleApp.kt` | `Clayver.configure` in `Application.onCreate` |
| `MainActivity.kt` | Firebase Auth email/password sign-in and sign-up (linking the anonymous user so chats started before login are kept), `setUserProperties`, `Clayver.logout()` before `FirebaseAuth.signOut()`, a support button with an unread badge (`unreadCountFlow`), `openChat`, `handleIntent` for tapped pushes, a **Register for push notifications** button (asks for the Android 13 notification permission, then passes the FCM token to `Clayver.setPushToken`), and, when `Clayver.agentRole()` is not null, a hint that the chat offers **Switch to support agent** |
| `ExampleMessagingService.kt` | Delegating `onNewToken` / `onMessageReceived` from the app's own `FirebaseMessagingService` |

The app depends on the published SDK, `com.marioiannotta.clayver:clayver-android`, from
Maven Central. To build the SDK from this repository instead, add
`clayver.localSdk=true` to `examples/android/gradle.properties` (or pass
`-Pclayver.localSdk=true`); `settings.gradle.kts` then substitutes it with `../../android`.

## Run it

1. **Deploy Clayver** to a development Firebase project (database rules, Storage
   rules and Cloud Functions) with the Clayver CLI, and create the `default`
   workspace.
2. **Register the Android app** in the Firebase console: *Project settings → Your
   apps → Add app → Android*, package name `com.clayver.example`. Add your debug
   SHA-1 if you use other Firebase features that need it (Clayver does not).
3. **Download `google-services.json`** from that screen and save it as
   `examples/android/app/google-services.json`. It is not committed; the build
   fails until it exists (the `com.google.gms.google-services` plugin reads it).
   The build uses the package name that file registers, so any package works.
   If the file registers several apps, pick one by adding
   `clayver.applicationId=<your package>` to `examples/android/local.properties`
   (not committed).
4. In the Firebase console enable **Authentication → Sign-in method →
   Email/Password** and **Anonymous** (lets people chat before they log in; pass
   `signInAnonymously = false` in `ClayverOptions` to require a signed-in user),
   **Realtime Database**, **Storage**, and **Cloud Messaging** (enabled by default).
5. Open `examples/android` in Android Studio (or run `./gradlew :app:installDebug`)
   and run on a device or emulator with Google Play services.

Send a message from the app, answer it from the Clayver dashboard, and watch
the unread badge and the push notification. Tap **Register for push
notifications** first; if notifications are off, the chat screen shows a banner
to turn them on (or to open Settings once Android can no longer ask).

**How login works.** There is no extra backend: users sign in with Firebase
Auth and the SDK follows the signed-in user (the customer id is the Firebase uid,
and push registrations move with it). Call `Clayver.logout()` before
`FirebaseAuth.signOut()` so the device stops getting that user's pushes.

**Agent mode.** Agents are Firebase Auth accounts of the same project. Create an
account in the app, grant it a role with
`clayver admin grant --email you@example.com --role agent`, and log in with it on
a second device or emulator: the **Agent inbox** button appears and you can
answer the first device's messages from the app itself.

### Using the Firebase Emulator Suite

Pass `emulator = ClayverEmulator()` in `ClayverOptions` (debug builds only).
`10.0.2.2` reaches the host machine from the Android emulator. Push delivery is
not emulated.
