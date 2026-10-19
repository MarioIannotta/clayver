package com.clayver.sdk

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.clayver.sdk.internal.ClayverCore
import com.clayver.sdk.internal.NotificationPayload
import com.clayver.sdk.internal.NotificationRouting
import com.clayver.sdk.internal.PushDestination
import com.clayver.sdk.internal.clayverCall
import com.clayver.sdk.notifications.ClayverNotifications
import com.clayver.sdk.ui.ClayverTheme
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Entry point of the Clayver Android SDK. See docs/sdk-api.md for the
 * cross-platform contract.
 *
 * Every suspend function throws [ClayverException] on failure and propagates
 * coroutine cancellation. Calls made while [configure] is still running wait
 * for it to finish.
 */
public object Clayver {
    private const val TAG = "Clayver"

    /**
     * Keys of user properties that the support UI understands: the dashboard and the agent
     * screens show them as the customer's name, email and user id instead of listing them with
     * the other properties. Their values must be strings.
     *
     * ```kotlin
     * Clayver.setUserProperties(
     *     mapOf(
     *         Clayver.UserProperty.NAME to name,
     *         Clayver.UserProperty.UID to user.id,
     *         "plan" to "pro",
     *     ),
     * )
     * ```
     *
     * Other keys can't start with `_`, so they never collide with these.
     */
    public object UserProperty {
        /** The customer's name, used to label them in the inbox and the conversation. */
        public const val NAME: String = "_name"

        /** The customer's email address, shown instead of the Firebase Auth email. */
        public const val EMAIL: String = "_email"

        /** Your app's own id for the user (for example its database id), shown as "User ID". */
        public const val UID: String = "_uid"

        /** Every reserved key. */
        public val ALL: Set<String> = setOf(NAME, EMAIL, UID)
    }

    @Volatile private var core: ClayverCore? = null
    @Volatile private var configuring: CompletableDeferred<ClayverCore>? = null
    private val configureMutex = Mutex()

    /** Scope for fire-and-forget work started from callbacks (FCM token refresh). */
    internal val sdkScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** True once [configure] has completed successfully. */
    public val isConfigured: Boolean get() = core != null

    /** The options passed to the last successful [configure], if any. */
    public val options: ClayverOptions? get() = core?.options

    internal val theme: ClayverTheme get() = core?.options?.theme ?: ClayverTheme()

    internal suspend fun core(): ClayverCore =
        core ?: configuring?.await() ?: throw ClayverException.notConfigured()

    // region setup and identity

    /**
     * Connects to Firebase and signs in anonymously if the app has no Firebase
     * user. Call it once, typically from `Application.onCreate` in a coroutine.
     * Calling it again with equal options is a no-op.
     */
    public suspend fun configure(context: Context, options: ClayverOptions = ClayverOptions()) {
        val appContext = context.applicationContext
        val deferred = configureMutex.withLock {
            val current = core
            if (current != null && current.options == options) return
            CompletableDeferred<ClayverCore>().also { configuring = it }
        }
        try {
            val created = clayverCall { ClayverCore.create(appContext, options) }
            core = created
            deferred.complete(created)
            created.reRegisterStoredPushToken()
        } catch (e: Throwable) {
            // Waiters get a ClayverException, never this coroutine's cancellation.
            deferred.completeExceptionally(
                if (e is CancellationException) ClayverException.notConfigured() else e,
            )
            throw e
        } finally {
            if (configuring === deferred) configuring = null
        }
    }

    /**
     * Removes this installation's push registrations for the signed-in user. Call it right
     * before you sign the user out of Firebase Auth, so a signed-out device stops getting
     * their notifications. An anonymous user is signed out by the SDK; your own signed-in
     * user is not (call `FirebaseAuth.getInstance().signOut()` yourself).
     */
    public suspend fun logout() {
        core().logout()
    }

    /**
     * Erases everything Clayver stores for the current customer (conversations,
     * messages, attachments, profile, push registrations; `clayverDeleteMyData`),
     * then [logout]s. Call it from your app's account deletion flow.
     */
    public suspend fun deleteCustomerData() {
        core().deleteCustomerData()
    }

    /**
     * Merges [properties] into `users/{cid}/properties`. Keys are the
     * [UserProperty] constants or match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`;
     * values are strings (≤ 1000 chars), numbers or booleans.
     */
    public suspend fun setUserProperties(properties: Map<String, Any>) {
        core().setUserProperties(properties)
    }

    // endregion

    // region push

    /** Registers this device's FCM registration token for Clayver pushes. */
    public suspend fun setPushToken(token: String) {
        core().setPushToken(token)
    }

    /** Removes this device's push registration (notifications opt-out). */
    public suspend fun clearPushToken() {
        core().clearPushToken()
    }

    /**
     * Call from `FirebaseMessagingService.onNewToken`. Stores the token and
     * registers it in the background (immediately, or once [configure] runs).
     */
    public fun onNewToken(context: Context, token: String) {
        ClayverCore.storePushToken(context, token)
        val c = core ?: return
        sdkScope.launch {
            try {
                c.setPushToken(token)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                Log.w(TAG, "Could not register the refreshed FCM token", e)
            }
        }
    }

    /**
     * Call from `FirebaseMessagingService.onMessageReceived`. Returns true if
     * the message was a Clayver push, in which case a notification that opens
     * the conversation has been shown (unless that chat is on screen or the app
     * may not post notifications). Returns false for other pushes.
     */
    public fun onMessageReceived(context: Context, message: RemoteMessage): Boolean {
        if (!NotificationPayload.isClayver(message.data)) return false
        ClayverNotifications.show(
            context = context,
            data = message.data,
            title = message.notification?.title,
            body = message.notification?.body,
            options = core?.options?.notifications ?: ClayverNotificationOptions(),
        )
        return true
    }

    /** True if [data] (an FCM data block or notification-tap extras) is a Clayver push. */
    public fun isClayverNotification(data: Map<String, String>): Boolean = NotificationPayload.isClayver(data)

    /**
     * Opens the conversation a Clayver push refers to: the customer chat for
     * `audience: "customer"` pushes, the agent conversation view for
     * `audience: "agent"` pushes. Returns false (and does nothing) when [data]
     * is not a Clayver push or belongs to another workspace.
     */
    public fun handleNotification(context: Context, data: Map<String, String>): Boolean {
        when (val destination = NotificationRouting.destination(data, core?.options?.projectId)) {
            null -> return false
            is PushDestination.CustomerChat -> openChat(context, destination.conversationId)
            is PushDestination.AgentConversation -> openAgentInbox(context, destination.conversationId)
        }
        return true
    }

    /**
     * Convenience for the launcher activity: when the user taps a Clayver push
     * delivered while the app was in the background, Android starts the launcher
     * activity with the push data as extras. Call this from `onCreate` and
     * `onNewIntent`; it opens the chat and returns true for Clayver pushes.
     * Also accepts `clayver://conversation/{id}` deep links.
     */
    public fun handleIntent(context: Context, intent: Intent?): Boolean {
        if (intent == null) return false
        val data = intent.extras?.toStringMap().orEmpty().toMutableMap()
        if (data.isEmpty() || !NotificationPayload.isClayver(data)) {
            val link = intent.dataString ?: return false
            NotificationPayload.conversationIdFromLink(link) ?: return false
            data.clear()
            data["clayver"] = "1"
            data["link"] = link
        }
        val handled = handleNotification(context, data)
        if (handled) intent.removeExtra("clayver") // don't reopen on configuration change
        return handled
    }

    // endregion

    // region inbox and messages

    /** Total unread agent messages across the customer's conversations (`inbox/{cid}/unreadTotal`). */
    public suspend fun getUnreadMessagesCount(): Int = core().unreadCount()

    /** Live unread total; follows identity changes. */
    public fun unreadCountFlow(): Flow<Int> = flow { emitAll(core().unreadCountFlow()) }

    /** The customer's conversations, newest first; follows identity changes. */
    public fun conversationsFlow(): Flow<List<ClayverConversation>> = flow { emitAll(core().conversationsFlow()) }

    /** Live window of the newest [limit] messages of a conversation, oldest first. */
    public fun messagesFlow(conversationId: String, limit: Int = 30): Flow<List<ClayverMessage>> =
        flow { emitAll(core().messagesFlow(conversationId, limit)) }

    /** Up to [limit] messages older than [beforeMessageId], oldest first. Empty when there are none. */
    public suspend fun loadOlderMessages(
        conversationId: String,
        beforeMessageId: String,
        limit: Int = 30,
    ): List<ClayverMessage> = core().loadOlderMessages(conversationId, beforeMessageId, limit)

    /**
     * Sends a message as the customer. Without [conversationId] it goes to the
     * customer's open conversation, creating one if there is none. Attachments
     * must be images (JPEG, PNG, GIF, WebP, HEIC); each is re-encoded as a JPEG
     * of at most 300 KB (longest side ≤ 1600 px) and uploaded to Cloud Storage first.
     */
    public suspend fun sendMessage(
        text: String?,
        conversationId: String? = null,
        attachment: ClayverAttachmentInput? = null,
    ): ClayverMessage = core().sendMessage(text, conversationId, attachment)

    /**
     * Starts a new conversation with this first message, even when the customer
     * already has an open one. The returned message carries the new conversation id.
     */
    public suspend fun startConversation(
        text: String?,
        attachment: ClayverAttachmentInput? = null,
    ): ClayverMessage = core().startConversation(text, attachment)

    /**
     * Emits the customer's active block (`moderation/{cid}`), or null while they
     * may write. A timed block turns into null by itself when it ends. While
     * blocked, sends fail with PERMISSION_DENIED.
     */
    public fun blockStatusFlow(): Flow<ClayverBlockStatus?> = flow { emitAll(core().blockStatusFlow()) }

    /** Marks every message of the conversation as read by the customer. */
    public suspend fun markConversationRead(conversationId: String) {
        core().markConversationRead(conversationId)
    }

    // endregion

    // region agent mode

    /**
     * The signed-in user's support role in this workspace, from the verified ID
     * token claim `clayver_roles[projectId]`, or null. Pass [forceRefresh] to
     * pick up a role granted or revoked while the app is running.
     */
    public suspend fun agentRole(forceRefresh: Boolean = false): ClayverAgentRole? = core().agentRole(forceRefresh)

    /** True when the signed-in user is an agent or admin of this workspace. */
    public suspend fun isAgent(): Boolean = agentRole() != null

    /**
     * Agent mode: the workspace's conversations with [status], newest first
     * (`orderByChild('statusOrder')`, at most [limit]). With [tagId], only the
     * conversations carrying that tag (read through `tagIndex/{tagId}`). Fails
     * with PERMISSION_DENIED when the user has no agent role.
     */
    public fun agentConversationsFlow(
        status: ClayverConversationStatus = ClayverConversationStatus.OPEN,
        limit: Int = 50,
        tagId: String? = null,
    ): Flow<List<ClayverAgentConversation>> = flow { emitAll(core().agentConversationsFlow(status, limit, tagId)) }

    /** Agent mode: a customer's profile (`users/{customerId}`), live. */
    public fun customerProfileFlow(customerId: String): Flow<ClayverCustomerProfile> =
        flow { emitAll(core().customerProfileFlow(customerId)) }

    /**
     * Agent mode: replies in [conversationId] as the signed-in agent
     * (`senderType: "agent"`, `senderName` from the agent record). Attachments
     * are compressed like customer ones (JPEG, ≤ 300 KB) and stored under the
     * conversation's customer.
     */
    public suspend fun sendAgentReply(
        conversationId: String,
        text: String?,
        attachment: ClayverAttachmentInput? = null,
    ): ClayverMessage = core().sendAgentReply(conversationId, text, attachment)

    /** Agent mode: closes or reopens a conversation. */
    public suspend fun setConversationStatus(conversationId: String, status: ClayverConversationStatus) {
        core().setConversationStatus(conversationId, status)
    }

    /** Agent mode: assigns the conversation to the signed-in agent, or unassigns it. */
    public suspend fun assignConversation(conversationId: String, toMe: Boolean) {
        core().assignConversation(conversationId, toMe)
    }

    /** Agent mode: moves the team's shared read marker (`reads/{id}/agent`) to now. */
    public suspend fun markConversationReadAsAgent(conversationId: String) {
        core().markConversationReadAsAgent(conversationId)
    }

    /** Agent mode: the workspace tag catalog, sorted by name. */
    public fun tagsFlow(): Flow<List<ClayverTag>> = flow { emitAll(core().tagsFlow()) }

    /**
     * Agent mode: creates a tag whose id is the slug of [name], or returns the
     * existing tag with that id. Without [color] (`#rrggbb`) the palette color
     * chosen by the slug is used.
     */
    public suspend fun createTag(name: String, color: String? = null): ClayverTag = core().createTag(name, color)

    /** Agent mode: the ids of the tags on a conversation, live. */
    public fun conversationTagsFlow(conversationId: String): Flow<List<String>> =
        flow { emitAll(core().conversationTagsFlow(conversationId)) }

    /** Agent mode: adds the tag [tagId] (which must exist) to the conversation. */
    public suspend fun addTag(conversationId: String, tagId: String) {
        core().addTag(conversationId, tagId)
    }

    /** Agent mode: removes the tag [tagId] from the conversation. */
    public suspend fun removeTag(conversationId: String, tagId: String) {
        core().removeTag(conversationId, tagId)
    }

    /**
     * Agent mode: the workspace's priority and status lists
     * (`triageOptions`), live. Lists never saved in the dashboard use the
     * defaults ([ClayverTriageOptions.DEFAULT_PRIORITY], [ClayverTriageOptions.DEFAULT_STAGE]).
     */
    public fun triageOptionsFlow(): Flow<ClayverTriageOptions> = flow { emitAll(core().triageOptionsFlow()) }

    /** Agent mode: a conversation's priority and status (`triage/{id}`), live. Customers never see them. */
    public fun triageFlow(conversationId: String): Flow<ClayverTriage> =
        flow { emitAll(core().triageFlow(conversationId)) }

    /** Agent mode: sets the conversation's priority to the option [optionId], or clears it when null. */
    public suspend fun setConversationPriority(conversationId: String, optionId: String?) {
        core().setTriage(conversationId, "priority", optionId)
    }

    /**
     * Agent mode: sets the conversation's status (stored as `stage`, shown as
     * "Status") to the option [optionId], or clears it when null. Independent
     * of [setConversationStatus] (open/closed).
     */
    public suspend fun setConversationStage(conversationId: String, optionId: String?) {
        core().setTriage(conversationId, "stage", optionId)
    }

    /** Agent mode: the conversation's internal notes, newest first, live. */
    public fun notesFlow(conversationId: String): Flow<List<ClayverNote>> =
        flow { emitAll(core().notesFlow(conversationId)) }

    /** Agent mode: adds an internal note (1..4000 characters) as the signed-in agent. */
    public suspend fun addNote(conversationId: String, text: String): ClayverNote = core().addNote(conversationId, text)

    /** Agent mode: deletes a note. Only its author or an admin may. */
    public suspend fun deleteNote(conversationId: String, noteId: String) {
        core().deleteNote(conversationId, noteId)
    }

    /** Agent mode: the support team (`agents`), sorted by name, live. */
    public fun teamFlow(): Flow<List<ClayverTeammate>> = flow { emitAll(core().teamFlow()) }

    /** Agent mode: all of a customer's conversations (open and closed), newest first, live. */
    public fun customerConversationsFlow(customerId: String, limit: Int = 50): Flow<List<ClayverAgentConversation>> =
        flow { emitAll(core().customerConversationsFlow(customerId, limit)) }

    /** Agent mode: the active block on a customer (`moderation/{customerId}`), or null, live. */
    public fun customerBlockStatusFlow(customerId: String): Flow<ClayverBlockStatus?> =
        flow { emitAll(core().customerBlockStatusFlow(customerId)) }

    /**
     * Agent mode: blocks a customer from starting conversations and sending
     * messages, until [until] (milliseconds since the epoch, in the future) or
     * until [unblockCustomer] when null. [reason] is SPAM, ABUSE or OTHER.
     */
    public suspend fun blockCustomer(customerId: String, reason: ClayverBlockReason, until: Long? = null) {
        core().blockCustomer(customerId, reason, until)
    }

    /** Agent mode: removes a customer's block. */
    public suspend fun unblockCustomer(customerId: String) {
        core().unblockCustomer(customerId)
    }

    /**
     * Opens the built-in agent inbox ([ClayverAgentInboxActivity]), on
     * [conversationId] when given. Users without a role see a "no access" screen.
     */
    public fun openAgentInbox(context: Context, conversationId: String? = null) {
        val intent = ClayverAgentInboxActivity.intent(context, conversationId)
        if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    // endregion

    // region UI

    /**
     * Opens the built-in chat ([ClayverChatActivity]). With [conversationId] it
     * shows that conversation (with a back button to the list when
     * [ClayverOptions.multipleConversations] is on). Without it: the
     * conversation list if the customer has any conversation, else a new empty
     * chat; with `multipleConversations = false`, the latest open conversation
     * (or a new one).
     */
    public fun openChat(context: Context, conversationId: String? = null) {
        start(context, ClayverChatActivity.intent(context, conversationId))
    }

    /** Opens the customer's conversation list ([ClayverConversationListScreen][com.clayver.sdk.ui.ClayverConversationListScreen]). */
    public fun openConversations(context: Context) {
        start(context, ClayverChatActivity.conversationsIntent(context))
    }

    /** Opens a new, empty chat; the conversation is created when the first message is sent. */
    public fun openNewConversation(context: Context) {
        start(context, ClayverChatActivity.newConversationIntent(context))
    }

    private fun start(context: Context, intent: Intent) {
        if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    // endregion
}

private fun Bundle.toStringMap(): Map<String, String> = buildMap {
    for (key in keySet()) {
        @Suppress("DEPRECATION")
        val value = get(key)
        if (value is String || value is Number || value is Boolean) put(key, value.toString())
    }
}
