package com.clayver.sdk.ui

import com.clayver.sdk.ClayverAttachment
import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverSenderType
import com.clayver.sdk.internal.DeviceIds
import com.clayver.sdk.internal.MessageRules
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.TreeMap

/**
 * The chat screen's state machine, free of Android and Firebase types so it
 * can be unit tested on the JVM. [ChatViewModel] owns one and runs it in
 * `viewModelScope`. All methods must be called from [scope]'s thread (the
 * main thread in production).
 */
internal class ChatController(
    private val repository: ChatRepository,
    private val scope: CoroutineScope,
    initialConversationId: String?,
    private val pageSize: Int = DEFAULT_PAGE_SIZE,
    private val clock: () -> Long = System::currentTimeMillis,
    private val newClientMessageId: () -> String = { DeviceIds.clientMessageId() },
    /**
     * Without [initialConversationId]: true starts an empty chat whose first
     * send creates a new conversation; false shows the latest open conversation.
     */
    private val newConversation: Boolean = false,
) {
    private val _state = MutableStateFlow(ChatUiState(conversationId = initialConversationId))
    val state: StateFlow<ChatUiState> = _state.asStateFlow()

    /** Server messages by push id; push ids sort chronologically. */
    private val server = TreeMap<String, ClayverMessage>()
    private val pending = LinkedHashMap<String, PendingSend>()
    private var agentLastReadAt: Long? = null
    private var customerLastReadAtAtOpen: Long? = null
    private var dividerComputed = false
    private var newestMarkedRead = Long.MIN_VALUE
    private var visible = false
    private var sessionJob: Job? = null
    private val sendMutex = Mutex()

    private class PendingSend(val item: ChatItem, val text: String?, val attachment: ClayverAttachmentInput?)

    init {
        start(keepContent = false)
        scope.launch {
            try {
                repository.blockStatus().collect { block -> _state.update { it.copy(blocked = block) } }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                // Best effort: without it, a blocked customer's sends simply fail.
            }
        }
    }

    // region lifecycle

    /** Retries after [ChatPhase.Failed]. */
    fun retry() = start(keepContent = false)

    /** Called by the screen when it is resumed/paused; read markers are only written while visible. */
    fun setVisible(isVisible: Boolean) {
        visible = isVisible
        if (isVisible) maybeMarkRead()
    }

    private fun start(keepContent: Boolean) {
        sessionJob?.cancel()
        if (!keepContent) {
            server.clear()
            dividerComputed = false
            agentLastReadAt = null
            customerLastReadAtAtOpen = null
            _state.update {
                it.copy(phase = ChatPhase.Loading, hasOlder = false, loadingOlder = false, olderError = null)
            }
        }
        sessionJob = scope.launch {
            launch {
                val config = try {
                    repository.publicConfig()
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Throwable) {
                    null
                }
                if (config != null) _state.update { it.copy(config = config) }
            }
            try {
                val id = _state.value.conversationId ?: if (newConversation) null else pickConversation()
                if (id == null) {
                    // No conversation yet: the first send creates one (never an empty one before).
                    _state.update { it.copy(phase = ChatPhase.Ready) }
                    publish()
                    return@launch
                }
                _state.update { it.copy(conversationId = id) }
                observe(id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _state.update { it.copy(phase = ChatPhase.Failed(e.toClayver())) }
            }
        }
    }

    private suspend fun pickConversation(): String? =
        repository.conversations().first().firstOrNull { it.status == ClayverConversationStatus.OPEN }?.id

    private suspend fun observe(conversationId: String) = coroutineScope {
        if (!dividerComputed) customerLastReadAtAtOpen = repository.customerLastReadAt(conversationId)
        launch {
            try {
                repository.agentLastReadAt(conversationId).collect {
                    agentLastReadAt = it
                    publish()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                // Read receipts are best effort; the chat works without them.
            }
        }
        var firstWindow = true
        repository.messages(conversationId, pageSize).collect { window ->
            window.forEach { server[it.id] = it }
            window.mapNotNull { it.clientMessageId }.forEach { pending.remove(it) }
            if (firstWindow) {
                firstWindow = false
                if (server.size <= window.size) _state.update { it.copy(hasOlder = window.size >= pageSize) }
            }
            if (!dividerComputed) computeDivider()
            _state.update { it.copy(phase = ChatPhase.Ready) }
            publish()
            maybeMarkRead()
        }
    }

    // endregion

    // region history

    fun loadOlder() {
        val s = _state.value
        val id = s.conversationId ?: return
        if (!s.hasOlder || s.loadingOlder || server.isEmpty()) return
        val oldest = server.firstKey()
        _state.update { it.copy(loadingOlder = true, olderError = null) }
        scope.launch {
            try {
                val older = repository.olderMessages(id, oldest, pageSize)
                older.forEach { server.putIfAbsent(it.id, it) }
                _state.update { it.copy(loadingOlder = false, hasOlder = older.size >= pageSize) }
                publish()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _state.update { it.copy(loadingOlder = false, olderError = e.toClayver()) }
            }
        }
    }

    // endregion

    // region composer

    fun onDraftChange(text: String) {
        _state.update { it.copy(draft = text.take(MessageRules.MAX_TEXT_LENGTH), composerError = null) }
    }

    fun attach(input: ClayverAttachmentInput) {
        try {
            input.validateDeclared()
            _state.update { it.copy(pendingAttachment = input, composerError = null) }
        } catch (e: ClayverException) {
            _state.update { it.copy(composerError = e) }
        }
    }

    /** Reports a failure that happened while preparing an attachment (e.g. reading the picked file). */
    fun reportComposerError(error: Throwable) {
        _state.update { it.copy(composerError = error.toClayver()) }
    }

    fun removeAttachment() {
        _state.update { it.copy(pendingAttachment = null, composerError = null) }
    }

    fun send() {
        val s = _state.value
        if (!s.canSend || s.blocked != null) return
        val text = try {
            MessageRules.normalizeText(s.draft)
        } catch (e: ClayverException) {
            _state.update { it.copy(composerError = e) }
            return
        }
        val attachment = s.pendingAttachment
        if (text == null && attachment == null) return
        val clientMessageId = newClientMessageId()
        val local = ClayverMessage(
            id = clientMessageId,
            conversationId = s.conversationId.orEmpty(),
            senderId = "",
            senderType = ClayverSenderType.CUSTOMER,
            text = text,
            attachment = attachment?.let {
                ClayverAttachment("", it.fileName, it.contentType, it.size ?: 0L, it.width, it.height)
            },
            createdAt = clock(),
            clientMessageId = clientMessageId,
        )
        pending[clientMessageId] = PendingSend(
            ChatItem(clientMessageId, local, DeliveryState.SENDING, isLocal = true),
            text,
            attachment,
        )
        _state.update { it.copy(draft = "", pendingAttachment = null, composerError = null) }
        publish()
        deliver(clientMessageId)
    }

    fun retrySend(key: String) {
        val p = pending[key] ?: return
        if (p.item.delivery != DeliveryState.FAILED) return
        pending[key] = PendingSend(p.item.copy(delivery = DeliveryState.SENDING, error = null), p.text, p.attachment)
        publish()
        deliver(key)
    }

    fun discard(key: String) {
        if (pending.remove(key) != null) publish()
    }

    private fun deliver(clientMessageId: String) {
        scope.launch {
            // Serialised so a burst of sends on a brand-new chat creates one conversation.
            sendMutex.withLock {
                val p = pending[clientMessageId] ?: return@withLock
                try {
                    val conversationId = _state.value.conversationId
                    val sent = if (conversationId == null && newConversation) {
                        repository.startConversation(p.text, p.attachment, clientMessageId)
                    } else {
                        repository.send(p.text, conversationId, p.attachment, clientMessageId)
                    }
                    pending.remove(clientMessageId)
                    server.putIfAbsent(sent.id, sent)
                    if (conversationId == null) {
                        dividerComputed = true // everything in a new conversation is already "read"
                        _state.update { it.copy(conversationId = sent.conversationId, phase = ChatPhase.Ready) }
                        start(keepContent = true)
                    }
                    publish()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    pending[clientMessageId]?.let {
                        pending[clientMessageId] = PendingSend(
                            it.item.copy(delivery = DeliveryState.FAILED, error = e.toClayver()),
                            it.text,
                            it.attachment,
                        )
                    }
                    publish()
                }
            }
        }
    }

    // endregion

    private fun computeDivider() {
        if (server.isEmpty()) return
        dividerComputed = true
        val lastRead = customerLastReadAtAtOpen ?: Long.MIN_VALUE
        val firstUnread = server.values.firstOrNull { !it.isFromCustomer && it.createdAt > lastRead }
        _state.update { it.copy(unreadDividerBeforeId = firstUnread?.id) }
    }

    private fun maybeMarkRead() {
        val id = _state.value.conversationId ?: return
        if (!visible) return
        val newest = server.values.lastOrNull { !it.isFromCustomer }?.createdAt ?: return
        if (newest <= newestMarkedRead) return
        newestMarkedRead = newest
        scope.launch {
            try {
                repository.markRead(id)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                newestMarkedRead = Long.MIN_VALUE // try again on the next update
            }
        }
    }

    private fun publish() {
        val readAt = agentLastReadAt
        val seen = if (readAt == null) null else server.values.lastOrNull { it.isFromCustomer && it.createdAt <= readAt }?.id
        val items = ArrayList<ChatItem>(server.size + pending.size)
        server.values.mapTo(items) { ChatItem(it.id, it, DeliveryState.SENT) }
        pending.values.mapTo(items) { it.item }
        _state.update { it.copy(items = items, seenMessageId = seen) }
    }

    internal companion object {
        const val DEFAULT_PAGE_SIZE: Int = 30
    }
}

internal fun Throwable.toClayver(): ClayverException =
    this as? ClayverException ?: ClayverException(ClayverErrorCode.INTERNAL, message ?: toString(), this)
