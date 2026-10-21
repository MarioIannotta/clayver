# Push notifications

Clayver sends pushes through Firebase Cloud Messaging from Cloud Functions, in
both directions:

| Event | Who is notified |
| --- | --- |
| Customer sends a message | The conversation's assignee, if one is set and active; otherwise every active agent. Agents who turned push off in the dashboard are skipped. |
| Agent replies | Every active device of that customer, unless the customer set `users/{cid}/notifications/enabled = false`. The iOS badge carries the unread total. |

The sender is never notified about their own message. Each FCM token is
notified at most once per message. A retried function doesn't push twice,
because each message is claimed in `notificationLog`. Tokens that FCM reports
as unregistered or invalid are marked `active: false` and dropped from the token index.

## Device registrations

`devices/customers/{cid}/{deviceId}` and `devices/agents/{uid}/{deviceId}` hold
`{ uid, platform, pushToken, active, updatedAt }`. The SDKs:
- generate a stable `deviceId` per installation;
- update `pushToken` on refresh;
- re-register under the new uid when the Firebase Auth user changes, and remove
  the registration on `logout()` (call it before signing the user out);
- delete their registration on `clearPushToken()`.

If the same token appears under a different user, for example after switching
accounts on one phone, the older registration is removed automatically.
Registrations that haven't been refreshed for 270 days are pruned daily.

## Payload and deep links

```json
{ "clayver": "1", "type": "message", "projectId": "default",
  "conversationId": "…", "messageId": "…", "link": "clayver://conversation/…" }
```

Pass incoming notifications to `Clayver.handleNotification(...)`. It returns
`true` for Clayver pushes and opens the conversation. On Android, pushes shown by
the system carry the click action `CLAYVER_OPEN_CONVERSATION`, handled by the
SDK's `ClayverChatActivity`, so background taps open the conversation directly. Android uses the
`clayver_messages` notification channel and tags notifications by
conversation, so updates replace each other instead of stacking.

## iOS (APNs)

1. In the Apple Developer portal, create an APNs Authentication Key (.p8).
2. In the Firebase console, go to Project settings → Cloud Messaging → Apple app
   configuration, then upload the key with its Key ID and Team ID.
3. In Xcode, add the *Push Notifications* capability and *Background Modes →
   Remote notifications*.
4. Forward the APNs token: `try await Clayver.setPushToken(deviceToken)` in
   `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.

## Android

Add `firebase-messaging` (bundled with the SDK). On Android 13 and later,
request `POST_NOTIFICATIONS`. Forward `onNewToken` and `onMessageReceived` from
your `FirebaseMessagingService`, or use the SDK's service. See `android/README.md`.

## Dashboard (web push)

Set `VITE_FIREBASE_VAPID_KEY`, from Project settings → Cloud Messaging → Web
Push certificates, and turn on notifications on the dashboard's Settings page.
Set the function parameter `CLAYVER_DASHBOARD_URL` so clicks open the conversation.
