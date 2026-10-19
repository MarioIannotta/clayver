package com.clayver.sdk

import androidx.annotation.ColorInt
import androidx.annotation.DrawableRes
import com.clayver.sdk.ui.ClayverTheme
import com.google.firebase.FirebaseApp

/**
 * Configuration for [Clayver.configure]. Every field has a default, so
 * `ClayverOptions()` works for an app with one Firebase project and the
 * `default` workspace.
 */
public data class ClayverOptions(
    /** Clayver workspace key, `^[a-z0-9-]{1,40}$`. */
    val projectId: String = "default",
    /** Region the Clayver Cloud Functions are deployed to. */
    val functionsRegion: String = "us-central1",
    /** Realtime Database URL, for a non-default database instance. */
    val databaseURL: String? = null,
    /** Firebase app to use. Defaults to [firebaseAppName], then the default app. */
    val firebaseApp: FirebaseApp? = null,
    /** Name of an already initialised secondary [FirebaseApp]. */
    val firebaseAppName: String? = null,
    /** Look of the built-in chat UI. */
    val theme: ClayverTheme = ClayverTheme(),
    /** Local Firebase Emulator Suite (debug builds only). */
    val emulator: ClayverEmulator? = null,
    /** Push notifications shown by [Clayver.onMessageReceived]. */
    val notifications: ClayverNotificationOptions = ClayverNotificationOptions(),
    /**
     * Customers can keep several conversations: [Clayver.openChat] without an id
     * opens the conversation list when they have any. With false it opens the
     * latest conversation (or a new one) and there is no list.
     */
    val multipleConversations: Boolean = true,
    /**
     * Signs in anonymously when no Firebase user is signed in, so visitors can chat
     * before they log in (the default). Set it to false when your app requires sign-in:
     * the SDK then waits for your Firebase Auth sign-in, and calls that need a customer
     * throw NOT_AUTHENTICATED until a user is signed in.
     */
    val signInAnonymously: Boolean = true,
    /**
     * While notifications are off, the customer chat shows a dismissible banner at the
     * top: on Android 13+ it asks for the POST_NOTIFICATIONS permission; once the system
     * can no longer ask (permission permanently denied, or notifications turned off in
     * Settings) it offers to open the app's notification settings. Set it to false to
     * handle the permission yourself.
     */
    val showNotificationPrompt: Boolean = true,
)

/** Ports of the Firebase Emulator Suite. `10.0.2.2` is the host machine from the Android emulator. */
public data class ClayverEmulator(
    val host: String = "10.0.2.2",
    val authPort: Int = 9099,
    val databasePort: Int = 9000,
    val functionsPort: Int = 5001,
    val storagePort: Int = 9199,
)

public data class ClayverNotificationOptions(
    /** Small (status bar) icon. Must be a monochrome drawable. Defaults to a chat bubble. */
    @DrawableRes val smallIcon: Int? = null,
    /** Accent colour of the notification. */
    @ColorInt val color: Int? = null,
    /** Android notification channel id used for Clayver messages. */
    val channelId: String = "clayver_messages",
    /** User-visible channel name; defaults to the localised "Support messages". */
    val channelName: String? = null,
    /** Channel for pushes to agents (`audience: "agent"`), used in agent mode. */
    val agentChannelId: String = "clayver_agent_messages",
    /** User-visible agent channel name; defaults to the localised "Customer messages". */
    val agentChannelName: String? = null,
    /** Show a notification even when the chat for that conversation is on screen. */
    val showWhenChatVisible: Boolean = false,
)
