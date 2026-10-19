package com.clayver.sdk

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * A ready-made [FirebaseMessagingService] for apps that do not have their own.
 * Declare it in your app's manifest:
 *
 * ```xml
 * <service android:name="com.clayver.sdk.ClayverMessagingService" android:exported="false">
 *   <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter>
 * </service>
 * ```
 *
 * If your app already has a messaging service, do not declare this one;
 * call [Clayver.onNewToken] and [Clayver.onMessageReceived] from yours, or
 * subclass this and override [onNonClayverMessage] / [onTokenRefreshed].
 */
public open class ClayverMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Clayver.onNewToken(applicationContext, token)
        onTokenRefreshed(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        if (!Clayver.onMessageReceived(applicationContext, message)) onNonClayverMessage(message)
    }

    /** Called for pushes that are not Clayver's. */
    public open fun onNonClayverMessage(message: RemoteMessage) {}

    /** Called after Clayver has stored a refreshed token. */
    public open fun onTokenRefreshed(token: String) {}
}
