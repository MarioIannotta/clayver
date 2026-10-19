package com.clayver.sdk.notifications

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.TaskStackBuilder
import androidx.core.content.ContextCompat
import com.clayver.sdk.ClayverAgentInboxActivity
import com.clayver.sdk.ClayverChatActivity
import com.clayver.sdk.ClayverNotificationOptions
import com.clayver.sdk.R
import com.clayver.sdk.internal.NotificationPayload
import com.clayver.sdk.internal.NotificationRouting
import com.clayver.sdk.internal.PushAudience
import com.clayver.sdk.internal.PushDestination

/** Tracks which conversation the built-in screens show, so their pushes are not duplicated. */
internal object ChatVisibility {
    /** Shown in the customer chat. */
    @Volatile var visibleConversationId: String? = null

    /** Shown in the agent conversation view. */
    @Volatile var visibleAgentConversationId: String? = null
}

internal object ClayverNotifications {
    private const val TAG = "Clayver"
    private const val NOTIFICATION_TAG = "clayver"

    /** True when the app may post notifications (runtime permission on API 33+, and not blocked by the user). */
    fun canPost(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    fun ensureChannel(context: Context, options: ClayverNotificationOptions, audience: PushAudience = PushAudience.CUSTOMER) {
        val id = NotificationRouting.channelId(audience, options.channelId, options.agentChannelId)
        val (name, description) = when (audience) {
            PushAudience.CUSTOMER ->
                (options.channelName ?: context.getString(R.string.clayver_notification_channel_name)) to
                    context.getString(R.string.clayver_notification_channel_description)
            PushAudience.AGENT ->
                (options.agentChannelName ?: context.getString(R.string.clayver_agent_notification_channel_name)) to
                    context.getString(R.string.clayver_agent_notification_channel_description)
        }
        val channel = NotificationChannelCompat.Builder(id, NotificationManagerCompat.IMPORTANCE_HIGH)
            .setName(name)
            .setDescription(description)
            .build()
        NotificationManagerCompat.from(context).createNotificationChannel(channel)
    }

    @SuppressLint("MissingPermission") // checked by canPost()
    fun show(context: Context, data: Map<String, String>, title: String?, body: String?, options: ClayverNotificationOptions) {
        val payload = NotificationPayload.parse(data) ?: return
        // Pushes of another workspace are still shown (the server sent them to this device), but open nothing else.
        val destination = NotificationRouting.destination(payload, configuredProjectId = null) ?: return
        val visible = NotificationRouting.shouldShow(
            destination,
            ChatVisibility.visibleConversationId,
            ChatVisibility.visibleAgentConversationId,
            options.showWhenChatVisible,
        )
        if (!visible) return
        if (!canPost(context)) {
            Log.i(TAG, "Clayver push not shown: notifications are not permitted for this app.")
            return
        }
        ensureChannel(context, options, payload.audience)
        val defaultTitle = when (payload.audience) {
            PushAudience.CUSTOMER -> R.string.clayver_notification_default_title
            PushAudience.AGENT -> R.string.clayver_agent_notification_default_title
        }
        val channelId = NotificationRouting.channelId(payload.audience, options.channelId, options.agentChannelId)
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(options.smallIcon ?: R.drawable.clayver_ic_notification)
            .setContentTitle(title ?: context.getString(defaultTitle))
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(contentIntent(context, destination))
            .apply { options.color?.let { setColor(it) } }
            .build()
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_TAG, NotificationRouting.notificationId(destination), notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "Clayver push not shown", e)
        }
    }

    /** Removes the customer notification of a conversation that is now on screen. */
    fun cancel(context: Context, conversationId: String) {
        cancel(context, PushDestination.CustomerChat(conversationId))
    }

    fun cancel(context: Context, destination: PushDestination) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_TAG, NotificationRouting.notificationId(destination))
    }

    /** Opens the chat (or the agent view) on top of the app's launcher activity, so Back returns into the app. */
    private fun contentIntent(context: Context, destination: PushDestination): PendingIntent {
        val conversationId = destination.conversationId
        val screen = when (destination) {
            is PushDestination.CustomerChat -> ClayverChatActivity.intent(context, conversationId)
            is PushDestination.AgentConversation -> ClayverAgentInboxActivity.intent(context, conversationId)
        }.setData(Uri.parse(NotificationPayload.linkFor(conversationId))) // distinct per conversation
        val stack = TaskStackBuilder.create(context)
        context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { stack.addNextIntent(it) }
        stack.addNextIntent(screen)
        return stack.getPendingIntent(
            NotificationRouting.notificationId(destination),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )!!
    }
}
