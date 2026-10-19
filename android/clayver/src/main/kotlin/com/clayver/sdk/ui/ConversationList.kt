package com.clayver.sdk.ui

import com.clayver.sdk.ClayverConversation
import com.clayver.sdk.ClayverPublicConfig
import com.clayver.sdk.ClayverSenderType
import com.clayver.sdk.internal.NotificationPayload
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

// region models

/** The last message of a conversation as the list shows it. */
internal sealed interface ConversationPreview {
    val fromCustomer: Boolean

    data class Text(val text: String, override val fromCustomer: Boolean) : ConversationPreview

    /** A message with only an attachment: "Attachment". */
    data class Attachment(override val fromCustomer: Boolean) : ConversationPreview
}

internal data class ConversationListRow(
    val conversationId: String,
    /** Null for a conversation without messages yet. */
    val preview: ConversationPreview?,
    /** Time of the last message, else of the last update. */
    val time: Long,
    val unread: Int,
)

internal data class ConversationListUiState(
    val phase: InboxPhase = InboxPhase.Loading,
    val rows: List<ConversationListRow> = emptyList(),
    val config: ClayverPublicConfig? = null,
) {
    val isEmpty: Boolean get() = phase == InboxPhase.Ready && rows.isEmpty()
}

// endregion

internal object ConversationListFormatting {

    fun preview(conversation: ClayverConversation): ConversationPreview? {
        val last = conversation.lastMessage ?: return null
        val fromCustomer = last.senderType == ClayverSenderType.CUSTOMER
        val text = last.text?.replace('\n', ' ')?.trim()?.takeIf(String::isNotEmpty)
        return when {
            text != null -> ConversationPreview.Text(text, fromCustomer)
            last.hasAttachment -> ConversationPreview.Attachment(fromCustomer)
            else -> null
        }
    }

    fun row(conversation: ClayverConversation): ConversationListRow = ConversationListRow(
        conversationId = conversation.id,
        preview = preview(conversation),
        time = conversation.lastMessage?.createdAt?.takeIf { it > 0 } ?: conversation.updatedAt,
        unread = conversation.unreadCount.coerceAtLeast(0),
    )

    /** Newest activity first; ties broken by id (push ids are chronological) so the order is stable. */
    fun rows(conversations: List<ClayverConversation>): List<ConversationListRow> =
        conversations
            .distinctBy { it.id }
            .sortedWith(compareByDescending<ClayverConversation> { it.updatedAt }.thenByDescending { it.id })
            .map(::row)
}

// region navigation

/** How the built-in chat was opened. */
internal enum class ChatEntry {
    /** `openChat()`: a given conversation, else the list or a new chat. */
    DEFAULT,

    /** `openConversations()`. */
    LIST,

    /** `openNewConversation()`. */
    NEW,
}

/** A screen of the customer chat's back stack. */
internal sealed interface ChatDestination {
    data object List : ChatDestination

    /** The latest open conversation, or a new one (`multipleConversations = false`). */
    data object Latest : ChatDestination

    /** An empty chat; [token] keeps each new chat's state separate. */
    data class New(val token: Int) : ChatDestination

    data class Conversation(val id: String) : ChatDestination
}

internal object ConversationRouting {

    /** True when [initialStack] needs to know whether the customer has any conversation. */
    fun needsConversationCount(entry: ChatEntry, conversationId: String?, multipleConversations: Boolean): Boolean =
        entry == ChatEntry.DEFAULT && conversationId == null && multipleConversations

    /**
     * The back stack the chat opens with (last = on screen), or null while
     * [hasConversations] is needed (see [needsConversationCount]) but unknown.
     * With multiple conversations the list sits under every chat (a given
     * conversation, a new chat, and the new chat `openChat()` shows a customer
     * with no conversation yet), so the chat's back button leads to it.
     */
    fun initialStack(
        entry: ChatEntry,
        conversationId: String?,
        multipleConversations: Boolean,
        hasConversations: Boolean?,
    ): List<ChatDestination>? {
        val list = if (multipleConversations) listOf(ChatDestination.List) else emptyList()
        return when (entry) {
            ChatEntry.LIST -> listOf(ChatDestination.List)
            ChatEntry.NEW -> list + ChatDestination.New(0)
            ChatEntry.DEFAULT -> when {
                conversationId != null -> list + ChatDestination.Conversation(conversationId)
                !multipleConversations -> listOf(ChatDestination.Latest)
                hasConversations == null -> null
                hasConversations -> listOf(ChatDestination.List)
                else -> listOf(ChatDestination.List, ChatDestination.New(0))
            }
        }
    }

    /** Saved-state form of a destination. */
    fun encode(destination: ChatDestination): String = when (destination) {
        ChatDestination.List -> "list"
        ChatDestination.Latest -> "latest"
        is ChatDestination.New -> "new:${destination.token}"
        is ChatDestination.Conversation -> "c:${destination.id}"
    }

    fun decode(value: String): ChatDestination? = when {
        value == "list" -> ChatDestination.List
        value == "latest" -> ChatDestination.Latest
        value.startsWith("new:") -> value.removePrefix("new:").toIntOrNull()?.let { ChatDestination.New(it) }
        value.startsWith("c:") -> value.removePrefix("c:").takeIf(NotificationPayload::isValidKey)?.let { ChatDestination.Conversation(it) }
        else -> null
    }
}

// endregion

/**
 * The customer conversation list's state machine, free of Android and
 * Firebase types. All methods must be called from [scope]'s thread.
 */
internal class ConversationListController(
    private val repository: ChatRepository,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(ConversationListUiState())
    val state: StateFlow<ConversationListUiState> = _state.asStateFlow()
    private var sessionJob: Job? = null

    init {
        scope.launch {
            val config = try {
                repository.publicConfig()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                null
            }
            if (config != null) _state.update { it.copy(config = config) }
        }
        start()
    }

    fun retry() = start()

    private fun start() {
        sessionJob?.cancel()
        _state.update { it.copy(phase = InboxPhase.Loading) }
        sessionJob = scope.launch {
            try {
                repository.conversations().collect { list ->
                    _state.update { it.copy(phase = InboxPhase.Ready, rows = ConversationListFormatting.rows(list)) }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _state.update { it.copy(phase = InboxPhase.Failed(e.toClayver())) }
            }
        }
    }
}
