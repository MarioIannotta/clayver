package com.clayver.sdk.ui

import com.clayver.sdk.ClayverAgentConversation
import com.clayver.sdk.ClayverAgentRole
import com.clayver.sdk.ClayverAttachment
import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.ClayverBlockReason
import com.clayver.sdk.ClayverBlockStatus
import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.ClayverCustomerProfile
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverNote
import com.clayver.sdk.ClayverPublicConfig
import com.clayver.sdk.ClayverSenderType
import com.clayver.sdk.ClayverTag
import com.clayver.sdk.ClayverTeammate
import com.clayver.sdk.ClayverTriage
import com.clayver.sdk.ClayverTriageOption
import com.clayver.sdk.ClayverTriageOptions
import com.clayver.sdk.internal.DeviceIds
import com.clayver.sdk.internal.MessageRules
import com.clayver.sdk.internal.TagRules
import com.clayver.sdk.internal.TriageRules
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.TreeMap

/** A conversation action in flight (the toolbar disables it meanwhile). */
internal enum class AgentAction { CLOSE, REOPEN, ASSIGN_TO_ME, UNASSIGN }

internal data class AgentChatUiState(
    val conversationId: String,
    val phase: ChatPhase = ChatPhase.Loading,
    val conversation: ClayverAgentConversation? = null,
    val profile: ClayverCustomerProfile? = null,
    val myUid: String? = null,
    /** Oldest first. Local (sending/failed) items come last. */
    val items: List<ChatItem> = emptyList(),
    val hasOlder: Boolean = false,
    val loadingOlder: Boolean = false,
    val olderError: ClayverException? = null,
    /** First customer message the team had not read when the view opened. */
    val unreadDividerBeforeId: String? = null,
    /** The newest agent message the customer has read ("Seen"). */
    val seenMessageId: String? = null,
    val draft: String = "",
    val pendingAttachment: ClayverAttachmentInput? = null,
    val composerError: ClayverException? = null,
    val action: AgentAction? = null,
    val actionError: ClayverException? = null,
    val config: ClayverPublicConfig? = null,
    /** The workspace tag catalog, sorted by name. */
    val tagCatalog: List<ClayverTag> = emptyList(),
    /** Ids of the conversation's tags, including changes still being written. */
    val tagIds: List<String> = emptyList(),
    /** True while a tag created from the "Add tag" sheet is being written. */
    val creatingTag: Boolean = false,
    val myRole: ClayverAgentRole? = null,
    /** The support team, for the assignee's name. */
    val team: List<ClayverTeammate> = emptyList(),
    val triageOptions: ClayverTriageOptions = ClayverTriageOptions(),
    /** Priority and status, including changes still being written. */
    val triage: ClayverTriage = ClayverTriage(),
    /** Internal notes, newest first. */
    val notes: List<ClayverNote> = emptyList(),
    val noteDraft: String = "",
    val addingNote: Boolean = false,
    /** Ids of notes being deleted (hidden meanwhile). */
    val deletingNoteIds: Set<String> = emptySet(),
    /** All of the customer's conversations, newest first (this one included). */
    val customerConversations: List<ClayverAgentConversation> = emptyList(),
    /** The customer's active block, or null. */
    val block: ClayverBlockStatus? = null,
    /** True while a block or unblock is being written. */
    val blockBusy: Boolean = false,
) {
    /** The priority option, or null when unset or not in the workspace list. */
    val priority: ClayverTriageOption? get() = TriageRules.resolve(triageOptions.priority, triage.priority)

    /** The status ("stage") option, or null when unset or not in the workspace list. */
    val stage: ClayverTriageOption? get() = TriageRules.resolve(triageOptions.stage, triage.stage)

    /** Notes shown in the details sheet: newest first, without those being deleted. */
    val visibleNotes: List<ClayverNote> get() = notes.filter { it.id !in deletingNoteIds }

    /** The author of a note or an admin may delete it. */
    fun canDelete(note: ClayverNote): Boolean = note.authorUid == myUid || myRole == ClayverAgentRole.ADMIN

    /** The assigned teammate's name (display name, else email); null when unassigned, assigned to me, or unknown. */
    val assigneeName: String?
        get() {
            val uid = conversation?.assigneeUid ?: return null
            if (uid == myUid) return null
            val mate = team.firstOrNull { it.uid == uid } ?: return null
            return mate.displayName ?: mate.email
        }

    /** The conversation's tags shown as chips (catalog order). */
    val tags: List<ClayverTag> get() = TagPicker.selected(tagCatalog, tagIds)
    val isClosed: Boolean get() = conversation?.status == ClayverConversationStatus.CLOSED
    val assignment: Assignment get() = AgentInboxFormatting.assignment(conversation?.assigneeUid, myUid)
    val customerName: CustomerName?
        get() = conversation?.let { AgentInboxFormatting.customerName(it.customerId, profile) }
    val canSend: Boolean get() = draft.isNotBlank() || pendingAttachment != null
}

/**
 * The agent conversation view's state machine: messages from the team's
 * perspective, replies, close/reopen, assignment, tags and the shared read marker.
 * Free of Android and Firebase types; all methods run on [scope]'s thread.
 */
internal class AgentConversationController(
    private val repository: AgentRepository,
    private val scope: CoroutineScope,
    conversationId: String,
    private val pageSize: Int = ChatController.DEFAULT_PAGE_SIZE,
    private val clock: () -> Long = System::currentTimeMillis,
    private val newClientMessageId: () -> String = { DeviceIds.clientMessageId() },
) {
    private val _state = MutableStateFlow(AgentChatUiState(conversationId = conversationId))
    val state: StateFlow<AgentChatUiState> = _state.asStateFlow()
    private val id: String = conversationId

    private val server = TreeMap<String, ClayverMessage>()
    private val pending = LinkedHashMap<String, PendingSend>()
    private var customerLastReadAt: Long? = null
    private var agentLastReadAtAtOpen: Long? = null
    private var dividerComputed = false
    private var newestMarkedRead = Long.MIN_VALUE
    private var visible = false
    private var sessionJob: Job? = null
    private var profileJob: Job? = null
    private var profileCustomerId: String? = null
    private val sendMutex = Mutex()
    private var liveTagIds: List<String> = emptyList()

    /** Tag changes not confirmed yet: tag id -> wanted on the conversation. */
    private val tagOverrides = LinkedHashMap<String, Boolean>()

    /** Triage changes not confirmed yet: field ("priority"/"stage") -> wanted option id (null clears). */
    private val triageOverrides = LinkedHashMap<String, String?>()
    private val triageWriteCounts = HashMap<String, Int>()
    private var liveTriage = ClayverTriage()

    private class PendingSend(val item: ChatItem, val text: String?, val attachment: ClayverAttachmentInput?)

    init {
        start()
    }

    // region lifecycle

    fun retry() = start()

    /** Read markers are only written while the view is on screen. */
    fun setVisible(isVisible: Boolean) {
        visible = isVisible
        if (isVisible) maybeMarkRead()
    }

    private fun start() {
        sessionJob?.cancel()
        profileJob = null
        profileCustomerId = null
        server.clear()
        dividerComputed = false
        customerLastReadAt = null
        agentLastReadAtAtOpen = null
        _state.update { it.copy(phase = ChatPhase.Loading, hasOlder = false, loadingOlder = false, olderError = null) }
        sessionJob = scope.launch {
            launch {
                val config = bestEffort { repository.publicConfig() }
                if (config != null) _state.update { it.copy(config = config) }
            }
            // Tags are best effort: the conversation works without them.
            launch { bestEffort { repository.tags().collect { tags -> _state.update { it.copy(tagCatalog = tags) } } } }
            launch {
                bestEffort {
                    repository.conversationTags(id).collect {
                        liveTagIds = it
                        publishTags()
                    }
                }
            }
            // The details sheet's data is best effort too.
            launch {
                val role = bestEffort { repository.role() }
                if (role != null) _state.update { it.copy(myRole = role) }
            }
            launch { bestEffort { repository.team().collect { team -> _state.update { it.copy(team = team) } } } }
            launch {
                bestEffort { repository.triageOptions().collect { options -> _state.update { it.copy(triageOptions = options) } } }
            }
            launch {
                bestEffort {
                    repository.triage(id).collect {
                        liveTriage = it
                        publishTriage()
                    }
                }
            }
            launch { bestEffort { repository.notes(id).collect { notes -> _state.update { it.copy(notes = notes) } } } }
            try {
                coroutineScope {
                    val uid = repository.currentUid()
                    _state.update { it.copy(myUid = uid) }
                    // The conversation record also proves the agent role: without one this fails first.
                    launch {
                        repository.conversation(id).collect { conversation ->
                            _state.update { it.copy(conversation = conversation) }
                            conversation?.customerId?.let { observeProfile(this@coroutineScope, it) }
                        }
                    }
                    launch {
                        try {
                            repository.customerLastReadAt(id).collect {
                                customerLastReadAt = it
                                publish()
                            }
                        } catch (e: CancellationException) {
                            throw e
                        } catch (_: Throwable) {
                            // "Seen" is best effort.
                        }
                    }
                    agentLastReadAtAtOpen = bestEffort { repository.agentLastReadAt(id) }
                    observeMessages()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _state.update { it.copy(phase = ChatPhase.Failed(e.toClayver())) }
            }
        }
    }

    /** The customer's profile, conversations and block status; best effort. */
    private fun observeProfile(sessionScope: CoroutineScope, customerId: String) {
        if (customerId == profileCustomerId) return
        profileJob?.cancel()
        profileCustomerId = customerId
        profileJob = sessionScope.launch {
            launch {
                bestEffort {
                    repository.customerConversations(customerId).collect { list ->
                        _state.update { it.copy(customerConversations = list) }
                    }
                }
            }
            launch { bestEffort { repository.customerBlock(customerId).collect { b -> _state.update { it.copy(block = b) } } } }
            try {
                repository.customerProfile(customerId).collect { p -> _state.update { it.copy(profile = p) } }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                // The header falls back to the short customer id.
            }
        }
    }

    private suspend fun observeMessages() {
        var firstWindow = true
        repository.messages(id, pageSize).collect { window ->
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

    fun reportComposerError(error: Throwable) {
        _state.update { it.copy(composerError = error.toClayver()) }
    }

    fun removeAttachment() {
        _state.update { it.copy(pendingAttachment = null, composerError = null) }
    }

    fun send() {
        val s = _state.value
        if (!s.canSend || s.phase != ChatPhase.Ready) return
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
            conversationId = id,
            senderId = s.myUid.orEmpty(),
            senderType = ClayverSenderType.AGENT,
            text = text,
            attachment = attachment?.let {
                ClayverAttachment("", it.fileName, it.contentType, it.size ?: 0L, it.width, it.height)
            },
            createdAt = clock(),
            clientMessageId = clientMessageId,
        )
        pending[clientMessageId] = PendingSend(ChatItem(clientMessageId, local, DeliveryState.SENDING, isLocal = true), text, attachment)
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
            sendMutex.withLock { // keeps replies in the order they were typed
                val p = pending[clientMessageId] ?: return@withLock
                try {
                    val sent = repository.send(id, p.text, p.attachment, clientMessageId)
                    pending.remove(clientMessageId)
                    server.putIfAbsent(sent.id, sent)
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

    // region conversation actions

    /** Closes an open conversation or reopens a closed one. */
    fun toggleStatus() {
        val conversation = _state.value.conversation ?: return
        val target = if (conversation.status == ClayverConversationStatus.CLOSED) {
            ClayverConversationStatus.OPEN
        } else {
            ClayverConversationStatus.CLOSED
        }
        val action = if (target == ClayverConversationStatus.CLOSED) AgentAction.CLOSE else AgentAction.REOPEN
        runAction(action, optimistic = { it.copy(status = target) }) { repository.setStatus(id, target) }
    }

    /** Assigns the conversation to the signed-in agent ([toMe]) or removes the assignee. */
    fun assign(toMe: Boolean) {
        val uid = _state.value.myUid
        if (toMe && uid == null) return
        val action = if (toMe) AgentAction.ASSIGN_TO_ME else AgentAction.UNASSIGN
        runAction(action, optimistic = { it.copy(assigneeUid = if (toMe) uid else null) }) { repository.assign(id, toMe) }
    }

    /** Adds the tag to the conversation, or removes it when it is already there. */
    fun toggleTag(tagId: String) {
        val wanted = tagId !in _state.value.tagIds
        tagOverrides[tagId] = wanted
        publishTags()
        scope.launch {
            var error: ClayverException? = null
            try {
                if (wanted) repository.addTag(id, tagId) else repository.removeTag(id, tagId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                error = e.toClayver()
            }
            if (tagOverrides[tagId] == wanted) tagOverrides.remove(tagId)
            if (error != null) _state.update { it.copy(actionError = error) }
            publishTags()
        }
    }

    /** Creates a tag named [name] (or finds the one with the same slug) and adds it to the conversation. */
    fun createTag(name: String) {
        if (_state.value.creatingTag || name.isBlank()) return
        _state.update { it.copy(creatingTag = true, actionError = null) }
        scope.launch {
            try {
                val tag = repository.createTag(name)
                // Shown at once, before the catalog listener catches up.
                _state.update { s ->
                    val catalog = if (s.tagCatalog.any { it.id == tag.id }) s.tagCatalog else (s.tagCatalog + tag).sortedWith(TagRules.ORDER)
                    s.copy(creatingTag = false, tagCatalog = catalog)
                }
                if (tag.id !in _state.value.tagIds) toggleTag(tag.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _state.update { it.copy(creatingTag = false, actionError = e.toClayver()) }
            }
        }
    }

    private fun publishTags() {
        val ids = LinkedHashSet(liveTagIds)
        tagOverrides.forEach { (tagId, wanted) -> if (wanted) ids.add(tagId) else ids.remove(tagId) }
        _state.update { it.copy(tagIds = ids.toList()) }
    }

    fun dismissActionError() {
        _state.update { it.copy(actionError = null) }
    }

    // region triage

    /** Sets the priority to [optionId], or clears it when null. */
    fun setPriority(optionId: String?) = writeTriage(TriageRules.PRIORITY, optionId) { repository.setPriority(id, it) }

    /** Sets the status ("stage") to [optionId], or clears it when null. */
    fun setStage(optionId: String?) = writeTriage(TriageRules.STAGE, optionId) { repository.setStage(id, it) }

    private fun writeTriage(field: String, optionId: String?, write: suspend (String?) -> Unit) {
        val current = if (field == TriageRules.PRIORITY) _state.value.triage.priority else _state.value.triage.stage
        if (current == optionId) return
        triageOverrides[field] = optionId
        triageWriteCounts[field] = (triageWriteCounts[field] ?: 0) + 1
        publishTriage()
        scope.launch {
            var error: ClayverException? = null
            try {
                write(optionId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                error = e.toClayver()
            }
            // The newest write wins; the live value takes over once none is in flight.
            val left = (triageWriteCounts[field] ?: 1) - 1
            if (left <= 0) {
                triageWriteCounts.remove(field)
                triageOverrides.remove(field)
            } else {
                triageWriteCounts[field] = left
            }
            if (error != null) _state.update { it.copy(actionError = error) }
            publishTriage()
        }
    }

    private fun publishTriage() {
        var triage = liveTriage
        if (triageOverrides.containsKey(TriageRules.PRIORITY)) triage = triage.copy(priority = triageOverrides[TriageRules.PRIORITY])
        if (triageOverrides.containsKey(TriageRules.STAGE)) triage = triage.copy(stage = triageOverrides[TriageRules.STAGE])
        _state.update { it.copy(triage = triage) }
    }

    // endregion

    // region notes

    fun onNoteDraftChange(text: String) {
        _state.update { it.copy(noteDraft = text.take(TriageRules.MAX_NOTE_LENGTH)) }
    }

    /** Adds the note draft; the draft is kept when the write fails. */
    fun addNote() {
        val s = _state.value
        if (s.addingNote || s.noteDraft.isBlank()) return
        val text = s.noteDraft
        _state.update { it.copy(addingNote = true, actionError = null) }
        scope.launch {
            try {
                val note = repository.addNote(id, text)
                _state.update { st ->
                    // Shown at once, before the listener catches up.
                    val notes = if (st.notes.any { it.id == note.id }) st.notes else listOf(note) + st.notes
                    st.copy(addingNote = false, noteDraft = if (st.noteDraft == text) "" else st.noteDraft, notes = notes)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _state.update { it.copy(addingNote = false, actionError = e.toClayver()) }
            }
        }
    }

    fun deleteNote(noteId: String) {
        if (noteId in _state.value.deletingNoteIds) return
        _state.update { it.copy(deletingNoteIds = it.deletingNoteIds + noteId, actionError = null) }
        scope.launch {
            try {
                repository.deleteNote(id, noteId)
                _state.update { st -> st.copy(notes = st.notes.filter { it.id != noteId }, deletingNoteIds = st.deletingNoteIds - noteId) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _state.update { it.copy(deletingNoteIds = it.deletingNoteIds - noteId, actionError = e.toClayver()) }
            }
        }
    }

    // endregion

    // region moderation

    /** Blocks the customer for [durationMillis] from now, or until unblocked when null. */
    fun blockCustomer(reason: ClayverBlockReason, durationMillis: Long?) {
        val customerId = _state.value.conversation?.customerId ?: return
        val until = durationMillis?.let { clock() + it }
        runModeration(optimistic = ClayverBlockStatus(reason, until)) { repository.block(customerId, reason, until) }
    }

    fun unblockCustomer() {
        val customerId = _state.value.conversation?.customerId ?: return
        runModeration(optimistic = null) { repository.unblock(customerId) }
    }

    private fun runModeration(optimistic: ClayverBlockStatus?, block: suspend () -> Unit) {
        val before = _state.value
        if (before.blockBusy) return
        val previous = before.block
        _state.update { it.copy(blockBusy = true, block = optimistic, actionError = null) }
        scope.launch {
            try {
                block()
                _state.update { it.copy(blockBusy = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _state.update {
                    it.copy(blockBusy = false, actionError = e.toClayver(), block = if (it.block == optimistic) previous else it.block)
                }
            }
        }
    }

    // endregion

    private fun runAction(
        action: AgentAction,
        optimistic: (ClayverAgentConversation) -> ClayverAgentConversation,
        block: suspend () -> Unit,
    ) {
        val before = _state.value
        if (before.action != null) return
        val previous = before.conversation ?: return
        _state.update { it.copy(action = action, actionError = null, conversation = optimistic(previous)) }
        scope.launch {
            try {
                block()
                _state.update { it.copy(action = null) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                // Revert unless the live record has moved on meanwhile.
                _state.update {
                    val reverted = if (it.conversation == optimistic(previous)) previous else it.conversation
                    it.copy(action = null, actionError = e.toClayver(), conversation = reverted)
                }
            }
        }
    }

    // endregion

    private fun computeDivider() {
        if (server.isEmpty()) return
        dividerComputed = true
        val lastRead = agentLastReadAtAtOpen ?: Long.MIN_VALUE
        val firstUnread = server.values.firstOrNull { it.isFromCustomer && it.createdAt > lastRead }
        _state.update { it.copy(unreadDividerBeforeId = firstUnread?.id) }
    }

    private fun maybeMarkRead() {
        if (!visible) return
        val newest = server.values.lastOrNull { it.isFromCustomer }?.createdAt ?: return
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
        val readAt = customerLastReadAt
        val seen = if (readAt == null) {
            null
        } else {
            server.values.lastOrNull { it.senderType == ClayverSenderType.AGENT && it.createdAt <= readAt }?.id
        }
        val items = ArrayList<ChatItem>(server.size + pending.size)
        server.values.mapTo(items) { ChatItem(it.id, it, DeliveryState.SENT) }
        pending.values.mapTo(items) { it.item }
        _state.update { it.copy(items = items, seenMessageId = seen) }
    }
}

private suspend inline fun <T> bestEffort(crossinline block: suspend () -> T): T? =
    try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Throwable) {
        null
    }
