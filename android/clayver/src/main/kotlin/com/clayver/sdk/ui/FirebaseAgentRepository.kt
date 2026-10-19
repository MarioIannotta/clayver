package com.clayver.sdk.ui

import com.clayver.sdk.Clayver
import com.clayver.sdk.ClayverAgentConversation
import com.clayver.sdk.ClayverAgentRole
import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.ClayverBlockReason
import com.clayver.sdk.ClayverBlockStatus
import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.ClayverCustomerProfile
import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverNote
import com.clayver.sdk.ClayverPublicConfig
import com.clayver.sdk.ClayverTag
import com.clayver.sdk.ClayverTeammate
import com.clayver.sdk.ClayverTriage
import com.clayver.sdk.ClayverTriageOptions
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow

/** [AgentRepository] backed by the configured Clayver instance (waits for configure if needed). */
internal class FirebaseAgentRepository : AgentRepository {
    override suspend fun currentUid(): String? = Clayver.core().currentUid()

    override fun conversations(status: ClayverConversationStatus, limit: Int, tagId: String?): Flow<List<ClayverAgentConversation>> =
        Clayver.agentConversationsFlow(status, limit, tagId)

    override fun conversation(conversationId: String): Flow<ClayverAgentConversation?> =
        flow { emitAll(Clayver.core().agentConversationFlow(conversationId)) }

    override fun customerProfile(customerId: String): Flow<ClayverCustomerProfile> = Clayver.customerProfileFlow(customerId)

    override fun messages(conversationId: String, limit: Int): Flow<List<ClayverMessage>> =
        Clayver.messagesFlow(conversationId, limit)

    override suspend fun olderMessages(conversationId: String, beforeMessageId: String, limit: Int): List<ClayverMessage> =
        Clayver.loadOlderMessages(conversationId, beforeMessageId, limit)

    override fun customerLastReadAt(conversationId: String): Flow<Long?> =
        flow { emitAll(Clayver.core().customerLastReadAtFlow(conversationId)) }

    override suspend fun agentLastReadAt(conversationId: String): Long? = Clayver.core().agentLastReadAt(conversationId)

    override suspend fun send(
        conversationId: String,
        text: String?,
        attachment: ClayverAttachmentInput?,
        clientMessageId: String,
    ): ClayverMessage = Clayver.core().sendAgentReply(conversationId, text, attachment, clientMessageId)

    override suspend fun setStatus(conversationId: String, status: ClayverConversationStatus) =
        Clayver.setConversationStatus(conversationId, status)

    override suspend fun assign(conversationId: String, toMe: Boolean) = Clayver.assignConversation(conversationId, toMe)

    override suspend fun markRead(conversationId: String) = Clayver.markConversationReadAsAgent(conversationId)

    override fun tags(): Flow<List<ClayverTag>> = Clayver.tagsFlow()

    override fun conversationTags(conversationId: String): Flow<List<String>> = Clayver.conversationTagsFlow(conversationId)

    override suspend fun addTag(conversationId: String, tagId: String) = Clayver.addTag(conversationId, tagId)

    override suspend fun removeTag(conversationId: String, tagId: String) = Clayver.removeTag(conversationId, tagId)

    override suspend fun createTag(name: String): ClayverTag = Clayver.createTag(name)

    override suspend fun role(): ClayverAgentRole? = Clayver.agentRole()

    override fun team(): Flow<List<ClayverTeammate>> = Clayver.teamFlow()

    override fun triageOptions(): Flow<ClayverTriageOptions> = Clayver.triageOptionsFlow()

    override fun triage(conversationId: String): Flow<ClayverTriage> = Clayver.triageFlow(conversationId)

    override suspend fun setPriority(conversationId: String, optionId: String?) =
        Clayver.setConversationPriority(conversationId, optionId)

    override suspend fun setStage(conversationId: String, optionId: String?) =
        Clayver.setConversationStage(conversationId, optionId)

    override fun notes(conversationId: String): Flow<List<ClayverNote>> = Clayver.notesFlow(conversationId)

    override suspend fun addNote(conversationId: String, text: String): ClayverNote = Clayver.addNote(conversationId, text)

    override suspend fun deleteNote(conversationId: String, noteId: String) = Clayver.deleteNote(conversationId, noteId)

    override fun customerConversations(customerId: String): Flow<List<ClayverAgentConversation>> =
        Clayver.customerConversationsFlow(customerId)

    override fun customerBlock(customerId: String): Flow<ClayverBlockStatus?> = Clayver.customerBlockStatusFlow(customerId)

    override suspend fun block(customerId: String, reason: ClayverBlockReason, until: Long?) =
        Clayver.blockCustomer(customerId, reason, until)

    override suspend fun unblock(customerId: String) = Clayver.unblockCustomer(customerId)

    override suspend fun publicConfig(): ClayverPublicConfig = Clayver.core().publicConfig()

    override suspend fun attachmentUrl(storagePath: String): String = Clayver.core().attachmentUrl(storagePath)
}
