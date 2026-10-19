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
import com.clayver.sdk.ui.ClayverAgentInboxScreen

/**
 * Full-screen host for [ClayverAgentInboxScreen] (agent mode), started by
 * [Clayver.openAgentInbox] and by agent notifications. Declared in the library
 * manifest (not exported).
 */
public class ClayverAgentInboxActivity : ComponentActivity() {
    private var conversationId by mutableStateOf<String?>(null)

    /** Bumped by every new intent so the same conversation can be reopened from a push. */
    private var generation by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        conversationId = if (savedInstanceState != null) {
            savedInstanceState.getString(ClayverChatActivity.EXTRA_CONVERSATION_ID)
        } else {
            conversationIdFrom(intent)
        }
        setContent {
            key(generation) {
                ClayverAgentInboxScreen(
                    initialConversationId = conversationId,
                    theme = Clayver.theme,
                    onClose = { finish() },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        conversationIdFrom(intent)?.let {
            conversationId = it
            generation++
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        conversationId?.let { outState.putString(ClayverChatActivity.EXTRA_CONVERSATION_ID, it) }
    }

    public companion object {
        /** An explicit intent for the agent inbox, optionally opened on a conversation. */
        public fun intent(context: Context, conversationId: String? = null): Intent =
            Intent(context, ClayverAgentInboxActivity::class.java).apply {
                conversationId?.let { putExtra(ClayverChatActivity.EXTRA_CONVERSATION_ID, it) }
            }

        private fun conversationIdFrom(intent: Intent?): String? {
            intent ?: return null
            intent.getStringExtra(ClayverChatActivity.EXTRA_CONVERSATION_ID)?.takeIf(NotificationPayload::isValidKey)?.let { return it }
            return NotificationPayload.conversationIdFromLink(intent.dataString)
        }
    }
}
