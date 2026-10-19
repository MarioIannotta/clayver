package com.clayver.sdk.ui

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

/**
 * Everything the agent inbox and the agent conversation view need. The
 * production implementation ([FirebaseAgentRepository]) delegates to the
 * configured Clayver instance; unit tests use a fake, so the controllers have
 * no Firebase or Android dependency.
 */
internal interface AgentRepository {
    /** The signed-in Firebase uid, or null. */
    suspend fun currentUid(): String?

    /**
     * Conversations with [status], newest first, only those tagged [tagId] when
     * set. Fails with PERMISSION_DENIED without a role.
     */
    fun conversations(status: ClayverConversationStatus, limit: Int, tagId: String?): Flow<List<ClayverAgentConversation>>

    /** One conversation record; null while it does not exist. */
    fun conversation(conversationId: String): Flow<ClayverAgentConversation?>

    fun customerProfile(customerId: String): Flow<ClayverCustomerProfile>

    /** Live window of the newest [limit] messages, oldest first. */
    fun messages(conversationId: String, limit: Int): Flow<List<ClayverMessage>>

    suspend fun olderMessages(conversationId: String, beforeMessageId: String, limit: Int): List<ClayverMessage>

    /** The customer's read marker (`reads/{id}/customer/lastReadAt`), used for "Seen". */
    fun customerLastReadAt(conversationId: String): Flow<Long?>

    /** The team's read marker at the time of the call, used for the unread divider. */
    suspend fun agentLastReadAt(conversationId: String): Long?

    suspend fun send(
        conversationId: String,
        text: String?,
        attachment: ClayverAttachmentInput?,
        clientMessageId: String,
    ): ClayverMessage

    suspend fun setStatus(conversationId: String, status: ClayverConversationStatus)

    suspend fun assign(conversationId: String, toMe: Boolean)

    suspend fun markRead(conversationId: String)

    /** The workspace tag catalog, sorted by name. */
    fun tags(): Flow<List<ClayverTag>>

    /** Ids of the tags on [conversationId]. */
    fun conversationTags(conversationId: String): Flow<List<String>>

    suspend fun addTag(conversationId: String, tagId: String)

    suspend fun removeTag(conversationId: String, tagId: String)

    /** Creates the tag (or returns the existing one with the same slug). */
    suspend fun createTag(name: String): ClayverTag

    /** The signed-in user's role, used to offer deleting teammates' notes to admins. */
    suspend fun role(): ClayverAgentRole?

    /** The support team, for the assignee's name. */
    fun team(): Flow<List<ClayverTeammate>>

    fun triageOptions(): Flow<ClayverTriageOptions>

    fun triage(conversationId: String): Flow<ClayverTriage>

    suspend fun setPriority(conversationId: String, optionId: String?)

    suspend fun setStage(conversationId: String, optionId: String?)

    /** Internal notes, newest first. */
    fun notes(conversationId: String): Flow<List<ClayverNote>>

    suspend fun addNote(conversationId: String, text: String): ClayverNote

    suspend fun deleteNote(conversationId: String, noteId: String)

    /** All of the customer's conversations, newest first. */
    fun customerConversations(customerId: String): Flow<List<ClayverAgentConversation>>

    fun customerBlock(customerId: String): Flow<ClayverBlockStatus?>

    suspend fun block(customerId: String, reason: ClayverBlockReason, until: Long?)

    suspend fun unblock(customerId: String)

    suspend fun publicConfig(): ClayverPublicConfig?

    suspend fun attachmentUrl(storagePath: String): String
}
