package com.clayver.example

import android.app.Application
import android.util.Log
import androidx.compose.ui.graphics.Color
import com.clayver.sdk.Clayver
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverOptions
import com.clayver.sdk.ui.ClayverColors
import com.clayver.sdk.ui.ClayverTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class ExampleApp : Application() {
    /** Application-lifetime scope for SDK setup. */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate() {
        super.onCreate()
        appScope.launch {
            try {
                // Uses the default FirebaseApp from google-services.json and the "default" workspace.
                Clayver.configure(
                    this@ExampleApp,
                    ClayverOptions(
                        projectId = "default",
                        theme = ClayverTheme(
                            lightColors = ClayverColors.light(accent = Color(0xFF0F766E)),
                        ),
                    ),
                )
                // The FCM token is registered from the "Register for push notifications"
                // button (MainActivity); refreshes arrive in ExampleMessagingService.onNewToken.
            } catch (e: ClayverException) {
                Log.e("ClayverExample", "Clayver setup failed: ${e.code.wireName}", e)
            }
        }
    }
}
