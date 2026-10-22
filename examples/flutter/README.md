# Clayver Flutter example

A minimal app that uses the [`clayver`](../../flutter) plugin:

- `Clayver.configure` after `Firebase.initializeApp`
- Firebase Auth email/password sign-in and sign-up (linking the anonymous user
  so chats started before login are kept), `Clayver.setUserProperties`, and
  `Clayver.logout()` before `FirebaseAuth.instance.signOut()`
- push registration: `FirebaseMessaging.getToken()` → `Clayver.setPushToken`,
  plus `onTokenRefresh`
- unread badges (app bar and the *Open chat* button) driven by
  `Clayver.unreadCountStream`, shown only when the count is above zero
- `Clayver.openChat` and notification taps through `Clayver.handleNotification`

On iOS the plugin's Swift package (`flutter/ios/clayver/Package.swift`) brings
in the native `ClayverSDK` package. On Android the plugin pulls
`com.marioiannotta.clayver:clayver-android` from Maven Central; add
`clayver.localSdk=true` to `android/gradle.properties` to build it from
`../../../android` instead.

## Prerequisites

- Flutter 3.32 or newer with Swift Package Manager enabled
  (`flutter config --enable-swift-package-manager`), Xcode 16+, Android Studio / Android SDK 35.
- A Firebase project with the Clayver backend deployed (`npx clayver init` from
  the repository root, see the [main README](../../README.md)). Enable the
  **Email/Password** and **Anonymous** sign-in methods in Firebase
  Authentication (anonymous sign-in lets people chat before they log in; pass
  `signInAnonymously: false` in `ClayverOptions` to require a signed-in user).

## 1. Connect your Firebase project

```sh
cd examples/flutter
dart pub global activate flutterfire_cli
flutterfire configure --platforms=ios,android
```

This replaces the placeholder `lib/firebase_options.dart` and writes
`ios/Runner/GoogleService-Info.plist` and `android/app/google-services.json`.
Pick the same Firebase project you deployed Clayver to.

There is no extra backend for login: users sign in with Firebase Auth and the
SDK follows the signed-in user (the customer id is the Firebase uid, and push
registrations move with it). Support agents are Firebase Auth accounts of the
same project, granted a role with
`npx clayver admin grant --email you@example.com --role agent`.

## 2. iOS push (APNs)

Push notifications need a real device and a paid Apple Developer account.

1. Open `ios/Runner.xcworkspace` in Xcode. Under *Runner → Signing &
   Capabilities* select your team, set a unique bundle identifier (the one you
   registered with `flutterfire configure`), then add the **Push
   Notifications** capability. *Background Modes → Remote notifications* is
   already enabled in `Info.plist`.
2. In the Apple Developer portal create an APNs **auth key** (.p8). Upload it in
   *Firebase console → Project settings → Cloud Messaging → Apple app
   configuration* with its Key ID and your Team ID.
3. `firebase_messaging` forwards the APNs token to FCM (method swizzling), so
   the app only deals with FCM tokens. *Register for push notifications* waits for the APNs token
   before calling `getToken()`.

## 3. Android push

Nothing to configure beyond `google-services.json`. On Android 13+ *Register
for push notifications* asks for the `POST_NOTIFICATIONS` permission declared in
`android/app/src/main/AndroidManifest.xml`. If notifications are off, the native
chat screen shows a banner to turn them on, or to open Settings once Android can
no longer ask.

## 4. Run

```sh
flutter run
```

1. **Create account** with an email and password, then **Save properties**. The customer and
   its properties appear in the Clayver dashboard.
2. **Register for push notifications**, then **Open chat** and send a message.
3. Reply from the dashboard. The badge in the app bar updates live; with the app
   in the background a notification arrives, and tapping it opens the
   conversation.
