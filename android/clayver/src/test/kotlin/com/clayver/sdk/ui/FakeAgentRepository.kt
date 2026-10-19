package com.clayver.sdk.ui

import com.clayver.sdk.ClayverAgentConversation
import com.clayver.sdk.ClayverAgentRole
import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.ClayverBlockReason
import com.clayver.sdk.ClayverBlockStatus
import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.ClayverCustomerProfile
import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverNote
import com.clayver.sdk.ClayverPublicConfig
import com.clayver.sdk.ClayverSenderType
import com.clayver.sdk.ClayverTag
import com.clayver.sdk.ClayverTeammate
import com.clayver.sdk.ClayverTriage
import com.clayver.sdk.ClayverTriageOptions
import com.clayver.sdk.internal.TagRules
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map

/** In-memory [AgentRepository] for controller tests. */
internal class FakeAgentRepository(var uid: String? = "me") : AgentRepository {
    var isAgent = true
    val inbox = mapOf(
        ClayverConversationStatus.OPEN to MutableStateFlow<List<ClayverAgentConversation>>(emptyList()),
        ClayverConversationStatus.CLOSED to MutableStateFlow<List<ClayverAgentConversation>>(emptyList()),
    )
    val records = mutableMapOf<String, MutableStateFlow<ClayverAgentConversation?>>()
    val profiles = mutableMapOf<String, MutableStateFlow<ClayverCustomerProfile?>>()
    val profileSubscriptions = mutableListOf<String>()
    val messagesByConversation = mutableMapOf<String, MutableStateFlow<List<ClayverMessage>>>()
    val customerRead = MutableStateFlow<Long?>(null)
    var agentRead: Long? = null
    var failSend: ClayverException? = null
    var failAction: ClayverException? = null
    var actionGate: CompletableDeferred<Unit>? = null
    val sent = mutableListOf<Triple<String, String?, String>>()
    val statusWrites = mutableListOf<Pair<String, ClayverConversationStatus>>()
    val assignWrites = mutableListOf<Pair<String, Boolean>>()
    val markedRead = mutableListOf<String>()

    /** Conversation ids per tag, for `conversations(tagId = ...)`. */
    val tagged = mutableMapOf<String, Set<String>>()
    val conversationRequests = mutableListOf<Pair<ClayverConversationStatus, String?>>()
    val catalog = MutableStateFlow<List<ClayverTag>>(emptyList())
    val tagsByConversation = mutableMapOf<String, MutableStateFlow<List<String>>>()
    var failTagWrite: ClayverException? = null
    var tagGate: CompletableDeferred<Unit>? = null
    val tagWrites = mutableListOf<Triple<String, String, Boolean>>()
    val createdTags = mutableListOf<String>()

    var role: ClayverAgentRole? = ClayverAgentRole.AGENT
    val teamFlow = MutableStateFlow<List<ClayverTeammate>>(emptyList())
    val triageOptionsFlow = MutableStateFlow(ClayverTriageOptions())
    val triageByConversation = mutableMapOf<String, MutableStateFlow<ClayverTriage>>()
    var failTriage: ClayverException? = null
    var triageGate: CompletableDeferred<Unit>? = null
    val triageWrites = mutableListOf<Triple<String, String, String?>>()
    val notesByConversation = mutableMapOf<String, MutableStateFlow<List<ClayverNote>>>()
    var failNote: ClayverException? = null
    val conversationsByCustomer = mutableMapOf<String, MutableStateFlow<List<ClayverAgentConversation>>>()
    val blocks = mutableMapOf<String, MutableStateFlow<ClayverBlockStatus?>>()
    var failBlock: ClayverException? = null
    val blockWrites = mutableListOf<Triple<String, ClayverBlockReason?, Long?>>()
    private var nextId = 100

    fun triageOf(id: String) = triageByConversation.getOrPut(id) { MutableStateFlow(ClayverTriage()) }
    fun notesOf(id: String) = notesByConversation.getOrPut(id) { MutableStateFlow(emptyList()) }
    fun customerConversationsOf(cid: String) = conversationsByCustomer.getOrPut(cid) { MutableStateFlow(emptyList()) }
    fun blockOf(cid: String) = blocks.getOrPut(cid) { MutableStateFlow(null) }

    fun record(id: String) = records.getOrPut(id) { MutableStateFlow(null) }
    fun profile(cid: String) = profiles.getOrPut(cid) { MutableStateFlow(null) }
    fun store(id: String) = messagesByConversation.getOrPut(id) { MutableStateFlow(emptyList()) }
    fun conversationTagIds(id: String) = tagsByConversation.getOrPut(id) { MutableStateFlow(emptyList()) }

    private fun denied() = ClayverException(ClayverErrorCode.PERMISSION_DENIED, "not an agent")

    override suspend fun currentUid(): String? = uid

    override fun conversations(status: ClayverConversationStatus, limit: Int, tagId: String?): Flow<List<ClayverAgentConversation>> {
        conversationRequests += status to tagId
        if (!isAgent) return flow { throw denied() }
        return inbox.getValue(status).map { list ->
            list.filter { tagId == null || it.id in tagged[tagId].orEmpty() }.take(limit)
        }
    }

    override fun conversation(conversationId: String): Flow<ClayverAgentConversation?> {
        if (!isAgent) return flow { throw denied() }
        return record(conversationId)
    }

    override fun customerProfile(customerId: String): Flow<ClayverCustomerProfile> {
        profileSubscriptions += customerId
        return profile(customerId).filterNotNull()
    }

    override fun messages(conversationId: String, limit: Int): Flow<List<ClayverMessage>> =
        store(conversationId).map { it.sortedBy(ClayverMessage::id).takeLast(limit) }

    override suspend fun olderMessages(conversationId: String, beforeMessageId: String, limit: Int): List<ClayverMessage> =
        store(conversationId).value.filter { it.id < beforeMessageId }.sortedBy { it.id }.takeLast(limit)

    override fun customerLastReadAt(conversationId: String): Flow<Long?> = customerRead
    override suspend fun agentLastReadAt(conversationId: String): Long? = agentRead

    override suspend fun send(
        conversationId: String,
        text: String?,
        attachment: ClayverAttachmentInput?,
        clientMessageId: String,
    ): ClayverMessage {
        failSend?.let { throw it }
        sent += Triple(conversationId, text, clientMessageId)
        val msg = ClayverMessage(
            id = "-M${nextId++}", conversationId = conversationId, senderId = uid.orEmpty(),
            senderType = ClayverSenderType.AGENT, senderName = "Me", text = text, createdAt = 5_000L + nextId,
            clientMessageId = clientMessageId,
        )
        store(conversationId).value = store(conversationId).value + msg
        return msg
    }

    override suspend fun setStatus(conversationId: String, status: ClayverConversationStatus) {
        actionGate?.await()
        failAction?.let { throw it }
        statusWrites += conversationId to status
        record(conversationId).value = record(conversationId).value?.copy(status = status)
    }

    override suspend fun assign(conversationId: String, toMe: Boolean) {
        actionGate?.await()
        failAction?.let { throw it }
        assignWrites += conversationId to toMe
        record(conversationId).value = record(conversationId).value?.copy(assigneeUid = if (toMe) uid else null)
    }

    override suspend fun markRead(conversationId: String) {
        markedRead += conversationId
    }

    override fun tags(): Flow<List<ClayverTag>> = catalog

    override fun conversationTags(conversationId: String): Flow<List<String>> = conversationTagIds(conversationId)

    override suspend fun addTag(conversationId: String, tagId: String) = writeTag(conversationId, tagId, true)

    override suspend fun removeTag(conversationId: String, tagId: String) = writeTag(conversationId, tagId, false)

    private suspend fun writeTag(conversationId: String, tagId: String, on: Boolean) {
        tagGate?.await()
        failTagWrite?.let { throw it }
        tagWrites += Triple(conversationId, tagId, on)
        val flow = conversationTagIds(conversationId)
        flow.value = if (on) (flow.value + tagId).distinct().sorted() else flow.value - tagId
    }

    override suspend fun createTag(name: String): ClayverTag {
        createdTags += name
        val id = TagRules.tagId(name.trim())
        catalog.value.firstOrNull { it.id == id }?.let { return it }
        return ClayverTag(id, name.trim(), TagRules.defaultColor(id))
    }

    override suspend fun role(): ClayverAgentRole? = role

    override fun team(): Flow<List<ClayverTeammate>> = teamFlow

    override fun triageOptions(): Flow<ClayverTriageOptions> = triageOptionsFlow

    override fun triage(conversationId: String): Flow<ClayverTriage> = triageOf(conversationId)

    override suspend fun setPriority(conversationId: String, optionId: String?) = writeTriage(conversationId, "priority", optionId)

    override suspend fun setStage(conversationId: String, optionId: String?) = writeTriage(conversationId, "stage", optionId)

    private suspend fun writeTriage(conversationId: String, field: String, optionId: String?) {
        triageGate?.await()
        failTriage?.let { throw it }
        triageWrites += Triple(conversationId, field, optionId)
        val flow = triageOf(conversationId)
        flow.value = if (field == "priority") flow.value.copy(priority = optionId) else flow.value.copy(stage = optionId)
    }

    override fun notes(conversationId: String): Flow<List<ClayverNote>> = notesOf(conversationId)

    override suspend fun addNote(conversationId: String, text: String): ClayverNote {
        failNote?.let { throw it }
        val note = ClayverNote("-N${nextId++}", conversationId, uid.orEmpty(), "Me", text.trim(), 9_000L + nextId)
        notesOf(conversationId).value = listOf(note) + notesOf(conversationId).value
        return note
    }

    override suspend fun deleteNote(conversationId: String, noteId: String) {
        failNote?.let { throw it }
        notesOf(conversationId).value = notesOf(conversationId).value.filter { it.id != noteId }
    }

    override fun customerConversations(customerId: String): Flow<List<ClayverAgentConversation>> = customerConversationsOf(customerId)

    override fun customerBlock(customerId: String): Flow<ClayverBlockStatus?> = blockOf(customerId)

    override suspend fun block(customerId: String, reason: ClayverBlockReason, until: Long?) {
        failBlock?.let { throw it }
        blockWrites += Triple(customerId, reason, until)
        blockOf(customerId).value = ClayverBlockStatus(reason, until)
    }

    override suspend fun unblock(customerId: String) {
        failBlock?.let { throw it }
        blockWrites += Triple(customerId, null, null)
        blockOf(customerId).value = null
    }

    override suspend fun publicConfig(): ClayverPublicConfig = ClayverPublicConfig(accentColor = "#112233")
    override suspend fun attachmentUrl(storagePath: String): String = "https://example/$storagePath"
}

internal fun agentConv(
    id: String,
    customerId: String = "cust-$id",
    status: ClayverConversationStatus = ClayverConversationStatus.OPEN,
    updatedAt: Long = 0L,
    unread: Int = 0,
    assignee: String? = null,
) = ClayverAgentConversation(id, customerId, status, 0L, updatedAt, null, unread, assignee)
