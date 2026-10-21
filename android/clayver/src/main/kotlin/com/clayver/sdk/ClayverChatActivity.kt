package com.clayver.sdk

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import com.clayver.sdk.internal.NotificationPayload
import com.clayver.sdk.internal.NotificationRouting
import com.clayver.sdk.internal.PushDestination
import com.clayver.sdk.ui.ChatEntry
import com.clayver.sdk.ui.ClayverChatScreen
import com.clayver.sdk.ui.ClayverSupportRoot
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Full-screen host for the support UI, started by [Clayver.openChat],
 * [Clayver.openConversations], [Clayver.openNewConversation] and by Clayver
 * notifications (including the ones the system shows while the app is in the
 * background, through the `CLAYVER_OPEN_CONVERSATION` click action). It shows [ClayverChatScreen] and, with multiple
 * conversations, the conversation list; agents can switch it to the team
 * inbox (agent pushes open it there). Declared in the library manifest (not exported).
 */
public class ClayverChatActivity : ComponentActivity() {
    private var conversationId by mutableStateOf<String?>(null)
    private var agentConversationId by mutableStateOf<String?>(null)
    private var entry by mutableStateOf(ChatEntry.DEFAULT)

    /** Started by tapping a push the system showed; when nothing of the app is below, closing opens the app. */
    private var openedFromPush = false

    /** Bumped by every new intent so the chat is routed again (e.g. a push while the list is open). */
    private var generation by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState != null) {
            conversationId = savedInstanceState.getString(EXTRA_CONVERSATION_ID)
            agentConversationId = savedInstanceState.getString(EXTRA_AGENT_CONVERSATION_ID)
            entry = entryFrom(savedInstanceState.getString(EXTRA_ENTRY))
            openedFromPush = savedInstanceState.getBoolean(EXTRA_OPENED_FROM_PUSH)
        } else {
            route(intent)
        }
        if (openedFromPush && savedInstanceState == null && !Clayver.isConfiguredOrConfiguring) {
            // Cold start from a push: the app's configure() (Application.onCreate, in a coroutine)
            // usually starts right after this. Without it the chat cannot load, so the push goes
            // to the app's launcher activity instead (Clayver.handleIntent / onMessageOpenedApp).
            lifecycleScope.launch {
                val ready = !configuresFromAppUi() && withTimeoutOrNull(CONFIGURE_WAIT_MS) {
                    while (!Clayver.isConfiguredOrConfiguring) delay(25)
                    true
                } == true
                if (ready) showContent() else handOffToApp()
            }
        } else {
            showContent()
        }
    }

    private fun showContent() {
        setContent {
            key(generation) {
                ClayverSupportRoot(
                    entry = entry,
                    conversationId = conversationId,
                    agentConversationId = agentConversationId,
                    theme = Clayver.theme,
                    onClose = { finish() },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        route(intent)
        generation++
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        conversationId?.let { outState.putString(EXTRA_CONVERSATION_ID, it) }
        agentConversationId?.let { outState.putString(EXTRA_AGENT_CONVERSATION_ID, it) }
        outState.putString(EXTRA_ENTRY, entry.name)
        outState.putBoolean(EXTRA_OPENED_FROM_PUSH, openedFromPush)
    }

    /** Starts the app's launcher activity with the push's extras, as a tap without a click action would. */
    private fun handOffToApp() {
        openedFromPush = false
        packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
            intent?.extras?.let { launch.putExtras(it) }
            runCatching { startActivity(launch) }
        }
        finish()
    }

    /** Set by SDKs whose app calls configure() only once its UI runs (the Flutter plugin). */
    private fun configuresFromAppUi(): Boolean = runCatching {
        @Suppress("DEPRECATION")
        packageManager.getApplicationInfo(packageName, PackageManager.GET_META_DATA)
            .metaData?.getBoolean(META_CONFIGURES_FROM_APP_UI) == true
    }.getOrDefault(false)

    override fun finish() {
        // A push tapped while the app was not running starts this activity alone in the task:
        // return into the app instead of leaving the user on the home screen.
        if (openedFromPush && isTaskRoot) {
            packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
                runCatching { startActivity(launch) }
            }
        }
        super.finish()
    }

    private fun route(intent: Intent?) {
        if (intent?.action == ACTION_OPEN_CONVERSATION) {
            routePush(intent)
            return
        }
        agentConversationId = intent?.getStringExtra(EXTRA_AGENT_CONVERSATION_ID)?.takeIf(NotificationPayload::isValidKey)
        // An agent push's intent also carries the conversation link; it is not a customer conversation.
        conversationId = if (agentConversationId != null) null else conversationIdFrom(intent)
        entry = if (agentConversationId != null) ChatEntry.LIST else entryFrom(intent?.getStringExtra(EXTRA_ENTRY))
    }

    /** A system-shown push: FCM passes the push's data block as string extras. */
    private fun routePush(intent: Intent) {
        openedFromPush = true
        val data = intent.extras?.toStringMap().orEmpty()
        when (val destination = NotificationRouting.destination(data, Clayver.options?.projectId)) {
            is PushDestination.CustomerChat -> {
                agentConversationId = null
                conversationId = destination.conversationId
                entry = ChatEntry.DEFAULT
            }
            is PushDestination.AgentConversation -> {
                agentConversationId = destination.conversationId
                conversationId = null
                entry = ChatEntry.LIST
            }
            // Another workspace's push or an unreadable one: show the support UI as openChat() would.
            null -> {
                agentConversationId = null
                conversationId = null
                entry = ChatEntry.DEFAULT
            }
        }
    }

    public companion object {
        /** Click action of Clayver pushes (`android.notification.clickAction` in the push). */
        internal const val ACTION_OPEN_CONVERSATION: String = "CLAYVER_OPEN_CONVERSATION"
        private const val EXTRA_OPENED_FROM_PUSH: String = "com.clayver.sdk.OPENED_FROM_PUSH"
        private const val META_CONFIGURES_FROM_APP_UI: String = "com.clayver.sdk.CONFIGURES_FROM_APP_UI"
        private const val CONFIGURE_WAIT_MS: Long = 1_500
        internal const val EXTRA_CONVERSATION_ID: String = "com.clayver.sdk.CONVERSATION_ID"
        private const val EXTRA_ENTRY: String = "com.clayver.sdk.CHAT_ENTRY"
        private const val EXTRA_AGENT_CONVERSATION_ID: String = "com.clayver.sdk.AGENT_CONVERSATION_ID"

        /** An explicit intent for the chat, optionally on a given conversation (see [Clayver.openChat]). */
        public fun intent(context: Context, conversationId: String? = null): Intent =
            Intent(context, ClayverChatActivity::class.java).apply {
                conversationId?.let { putExtra(EXTRA_CONVERSATION_ID, it) }
            }

        /** An explicit intent for the conversation list (see [Clayver.openConversations]). */
        public fun conversationsIntent(context: Context): Intent =
            Intent(context, ClayverChatActivity::class.java).putExtra(EXTRA_ENTRY, ChatEntry.LIST.name)

        /** An explicit intent for a new, empty chat (see [Clayver.openNewConversation]). */
        public fun newConversationIntent(context: Context): Intent =
            Intent(context, ClayverChatActivity::class.java).putExtra(EXTRA_ENTRY, ChatEntry.NEW.name)

        /** Agent pushes: the support UI in agent mode with [conversationId] open over the inbox. */
        internal fun agentConversationIntent(context: Context, conversationId: String): Intent =
            Intent(context, ClayverChatActivity::class.java).putExtra(EXTRA_AGENT_CONVERSATION_ID, conversationId)

        private fun entryFrom(value: String?): ChatEntry = ChatEntry.entries.firstOrNull { it.name == value } ?: ChatEntry.DEFAULT

        private fun conversationIdFrom(intent: Intent?): String? {
            intent ?: return null
            intent.getStringExtra(EXTRA_CONVERSATION_ID)?.takeIf(NotificationPayload::isValidKey)?.let { return it }
            return NotificationPayload.conversationIdFromLink(intent.dataString)
        }
    }
}
