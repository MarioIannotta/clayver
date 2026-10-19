package com.clayver.sdk.ui

import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.ClayverBlockStatus
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverPublicConfig

internal enum class DeliveryState { SENT, SENDING, FAILED }

internal data class ChatItem(
    /** Server message id, or the clientMessageId while the message is local only. */
    val key: String,
    val message: ClayverMessage,
    val delivery: DeliveryState,
    /** True while the message only exists on this device (sending or failed). */
    val isLocal: Boolean = false,
    val error: ClayverException? = null,
)

internal sealed interface ChatPhase {
    data object Loading : ChatPhase
    data object Ready : ChatPhase
    data class Failed(val error: ClayverException) : ChatPhase
}

internal data class ChatUiState(
    val phase: ChatPhase = ChatPhase.Loading,
    val conversationId: String? = null,
    /** Oldest first. Local (sending/failed) items come last. */
    val items: List<ChatItem> = emptyList(),
    val hasOlder: Boolean = false,
    val loadingOlder: Boolean = false,
    val olderError: ClayverException? = null,
    /** The unread divider is drawn just before this message. */
    val unreadDividerBeforeId: String? = null,
    /** The newest customer message the agents have read ("Seen"). */
    val seenMessageId: String? = null,
    val draft: String = "",
    val pendingAttachment: ClayverAttachmentInput? = null,
    /** Validation error for the composer (e.g. file too large), cleared on the next edit. */
    val composerError: ClayverException? = null,
    val config: ClayverPublicConfig? = null,
    /** The customer's active block: the composer is replaced by a notice. */
    val blocked: ClayverBlockStatus? = null,
) {
    val canSend: Boolean get() = draft.isNotBlank() || pendingAttachment != null
    val isEmpty: Boolean get() = phase == ChatPhase.Ready && items.isEmpty()
}
