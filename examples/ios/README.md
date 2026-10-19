# Clayver iOS example

A minimal SwiftUI app that shows how to integrate `ClayverSDK`:

| File | Shows |
| --- | --- |
| `ClayverExample/ClayverExampleApp.swift` | `@UIApplicationDelegateAdaptor` wiring |
| `ClayverExample/AppDelegate.swift` | `FirebaseApp.configure()`, `Clayver.configure`, `PushRegistration` (permission request + `registerForRemoteNotifications()`, re-registering on launch when already allowed), APNs token → `Clayver.setPushToken`, `MessagingDelegate` → `Clayver.setFCMToken`, notification tap → `Clayver.handleNotification` |
| `ClayverExample/ContentView.swift` | a **Register for push notifications** button with the current push status, Firebase Auth email/password sign-in and sign-up (linking the anonymous user so chats started before login are kept), `setUserProperties` after login, `Clayver.logout()` before `Auth.auth().signOut()`, support button with live unread badge (`unreadCountUpdates`), a single "Contact support" button that presents `ClayverChatView` in a SwiftUI sheet (from UIKit, `Clayver.openChat()` does the same), and an "Agent inbox" section shown only when `Clayver.agentRole()` returns a role |

> These sources have not been compiled in CI yet. Please open an issue if something
> does not build with the current Xcode.

## 1. Open the project

Open `examples/ios/ClayverExample.xcodeproj` in Xcode 16 or later. The project already:

- includes everything in the `ClayverExample/` folder (it is a synchronized folder, so files
  you add there, such as `GoogleService-Info.plist`, join the app target automatically)
- links `ClayverSDK` from the repository's `ios/` folder as a local Swift package, plus
  `FirebaseCore`, `FirebaseMessaging` and `FirebaseAuth` from `firebase-ios-sdk`, which the example imports
  directly
- targets iOS 15.0 and enables **Background Modes → Remote notifications**

Xcode resolves the packages the first time you open it. To run on a device, pick your team
under **Signing & Capabilities** and change the bundle id (`com.clayver.example`) to one you
own.

## 2. Connect your Firebase project

1. Deploy the Clayver backend to your Firebase project (`npx clayver init` from the repo
   root, see the main README). This creates the database rules, Storage rules and Cloud
   Functions.
2. In the Firebase console → Project settings → **Add app → iOS**, use your bundle id,
   download **`GoogleService-Info.plist`** and put it in `examples/ios/ClayverExample/`.
   It is git-ignored, so it stays on your machine.
3. Firebase console → Authentication → Sign-in method: enable **Email/Password** (how the
   example logs users in) and **Anonymous** (lets people chat before they log in; turn it
   off with `ClayverOptions(signInAnonymously: false)` if you only want signed-in users).

## 3. Push notifications (optional, needs a real device)

1. Target → **Signing & Capabilities**: add **Push Notifications** (needs a paid Apple
   Developer team; Background Modes → Remote notifications is already on).
2. Apple Developer portal → Keys: create an **APNs auth key** (.p8). Upload it in Firebase
   console → Project settings → **Cloud Messaging → Apple app configuration**, with your
   Key ID and Team ID.
3. Run on a device and tap **Register for push notifications** (or **Turn on** in the banner
   the chat shows while notifications are off), accept the permission prompt, and wait for
   the status to read *Registered*. Then reply to the conversation from the Clayver
   dashboard. Tapping the push opens the chat on that conversation. If you denied the
   prompt, the chat banner offers to open Settings instead.

## 4. Agent mode (optional)

Support agents are Firebase Auth accounts of the same project. Create an account in the app,
grant it a role, then log in again (or tap **Refresh support role**):

```sh
npx clayver admin grant --email you@example.com --role agent
```

The **Agent inbox** section appears, and with push set up this device also receives the
pushes sent to agents (`devices/agents/{uid}`); tapping one opens that conversation in the
agent view.

## 5. How login works

There is no extra backend: users sign in with Firebase Auth, and the SDK follows the
signed-in user (the customer id is the Firebase uid, and push registrations move with it).
Use any Firebase Auth provider your app already supports; the example uses email/password.

- **Sign-up** links the email credential to the anonymous user when there is one
  (`user.link(with:)`), so the uid and any conversation started before login are kept.
  Signing in to an *existing* account switches to that account's uid instead.
- **Log out**: call `Clayver.logout()` first (it removes this device's push registrations
  while the user is still signed in), then `Auth.auth().signOut()`.

## Using the emulators

```swift
try await Clayver.configure(ClayverOptions(useEmulator: .init(host: "localhost")))
```

On a device, use your Mac's LAN IP instead of `localhost`, and allow arbitrary loads for
that host in `Info.plist` (`NSAppTransportSecurity`).
