package com.clayver.example

import com.clayver.sdk.Clayver
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * An app that already has a FirebaseMessagingService delegates to Clayver.
 * (Apps without one can declare com.clayver.sdk.ClayverMessagingService instead.)
 */
class ExampleMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        Clayver.onNewToken(applicationContext, token)
        // ...send the token to your own backend too, if you use FCM yourself.
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (Clayver.onMessageReceived(applicationContext, message)) return
        // ...handle the app's own pushes here.
    }
}
