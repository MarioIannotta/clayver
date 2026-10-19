package com.clayver.sdk

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.clayver.sdk.internal.NotificationPayload
import com.clayver.sdk.ui.ChatEntry
import com.clayver.sdk.ui.ClayverChatRoot
import com.clayver.sdk.ui.ClayverChatScreen

/**
 * Full-screen host for the customer chat, started by [Clayver.openChat],
 * [Clayver.openConversations], [Clayver.openNewConversation] and by Clayver
 * notifications. It shows [ClayverChatScreen] and, with multiple
 * conversations, the conversation list. Declared in the library manifest (not exported).
 */
public class ClayverChatActivity : ComponentActivity() {
    private var conversationId by mutableStateOf<String?>(null)
    private var entry by mutableStateOf(ChatEntry.DEFAULT)

    /** Bumped by every new intent so the chat is routed again (e.g. a push while the list is open). */
    private var generation by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState != null) {
            conversationId = savedInstanceState.getString(EXTRA_CONVERSATION_ID)
            entry = entryFrom(savedInstanceState.getString(EXTRA_ENTRY))
        } else {
            conversationId = conversationIdFrom(intent)
            entry = entryFrom(intent?.getStringExtra(EXTRA_ENTRY))
        }
        setContent {
            key(generation) {
                ClayverChatRoot(
                    entry = entry,
                    conversationId = conversationId,
                    theme = Clayver.theme,
                    onClose = { finish() },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        conversationId = conversationIdFrom(intent)
        entry = entryFrom(intent.getStringExtra(EXTRA_ENTRY))
        generation++
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        conversationId?.let { outState.putString(EXTRA_CONVERSATION_ID, it) }
        outState.putString(EXTRA_ENTRY, entry.name)
    }

    public companion object {
        internal const val EXTRA_CONVERSATION_ID: String = "com.clayver.sdk.CONVERSATION_ID"
        private const val EXTRA_ENTRY: String = "com.clayver.sdk.CHAT_ENTRY"

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

        private fun entryFrom(value: String?): ChatEntry = ChatEntry.entries.firstOrNull { it.name == value } ?: ChatEntry.DEFAULT

        private fun conversationIdFrom(intent: Intent?): String? {
            intent ?: return null
            intent.getStringExtra(EXTRA_CONVERSATION_ID)?.takeIf(NotificationPayload::isValidKey)?.let { return it }
            return NotificationPayload.conversationIdFromLink(intent.dataString)
        }
    }
}
