package com.clayver.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.clayver.sdk.Clayver
import com.clayver.sdk.internal.ClayverCore
import com.clayver.sdk.internal.SupportMode
import com.clayver.sdk.internal.SupportModeStore
import kotlinx.coroutines.CancellationException

/**
 * The built-in support UI (used by [com.clayver.sdk.ClayverChatActivity]): the
 * customer side ([ClayverChatRoot]) or, for agents, the team inbox
 * ([ClayverAgentInboxScreen]). Agents switch with **Switch to support agent**
 * (under **New conversation**) and **Switch to regular user** (in the inbox);
 * the choice is remembered per user ([SupportModeStore]) and applies when the
 * UI opens without a given conversation ([ChatEntry.DEFAULT] without
 * [conversationId], or [ChatEntry.LIST]).
 *
 * @param agentConversationId an agent push: opens the inbox on this
 *   conversation whatever the remembered mode, without changing it.
 */
@Composable
internal fun ClayverSupportRoot(
    entry: ChatEntry,
    conversationId: String?,
    agentConversationId: String?,
    theme: ClayverTheme,
    onClose: () -> Unit,
) {
    val prefs = ClayverCore.prefs(LocalContext.current)
    val followsStoredMode = conversationId == null && entry != ChatEntry.NEW
    fun storedMode() = SupportModeStore.mode(prefs, Clayver.currentUid, Clayver.options?.projectId)

    var mode by rememberSaveable {
        mutableStateOf(
            when {
                agentConversationId != null -> SupportMode.AGENT
                followsStoredMode -> storedMode()
                else -> SupportMode.CUSTOMER
            },
        )
    }
    // Optimistic for a remembered agent; corrected by the role check below.
    var isAgent by rememberSaveable { mutableStateOf(mode == SupportMode.AGENT) }
    var customerEntry by rememberSaveable { mutableStateOf(entry) }
    var customerConversationId by rememberSaveable { mutableStateOf(conversationId) }
    var openAgentConversationId by rememberSaveable { mutableStateOf(agentConversationId) }

    // Shows the switch only to agents, drops a remembered agent mode for a user who lost the
    // role, and applies the remembered mode when configure had not finished on first composition.
    LaunchedEffect(Unit) {
        val agent = try {
            Clayver.isAgent()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            false
        }
        isAgent = agent
        if (!agent) {
            if (mode == SupportMode.AGENT && openAgentConversationId == null) mode = SupportMode.CUSTOMER
        } else if (followsStoredMode && mode == SupportMode.CUSTOMER && storedMode() == SupportMode.AGENT) {
            mode = SupportMode.AGENT
        }
    }

    val switchMode: (SupportMode) -> Unit = { next ->
        SupportModeStore.set(prefs, next, Clayver.currentUid, Clayver.options?.projectId)
        openAgentConversationId = null
        if (next == SupportMode.CUSTOMER) {
            // Back from the inbox: the list, never an automatic new chat.
            customerEntry = ChatEntry.LIST
            customerConversationId = null
        }
        mode = next
    }

    when (mode) {
        SupportMode.AGENT -> key(SupportMode.AGENT) {
            ClayverAgentInboxScreen(
                initialConversationId = openAgentConversationId,
                theme = theme,
                onClose = onClose,
                onSwitchToCustomer = { switchMode(SupportMode.CUSTOMER) },
            )
        }
        SupportMode.CUSTOMER -> key(SupportMode.CUSTOMER) {
            ClayverChatRoot(
                entry = customerEntry,
                conversationId = customerConversationId,
                theme = theme,
                onClose = onClose,
                onSwitchToAgent = if (isAgent) ({ switchMode(SupportMode.AGENT) }) else null,
            )
        }
    }
}
