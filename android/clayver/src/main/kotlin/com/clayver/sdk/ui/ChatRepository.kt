package com.clayver.sdk.ui

import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.ClayverBlockStatus
import com.clayver.sdk.ClayverConversation
import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverPublicConfig
import kotlinx.coroutines.flow.Flow

/**
 * Everything the chat UI needs from the backend. The production
 * implementation talks to Firebase (FirebaseChatRepository); unit tests use a
 * fake, so [ChatController] has no Firebase or Android dependency.
 */
internal interface ChatRepository {
    /** The customer's conversations, newest first. */
    fun conversations(): Flow<List<ClayverConversation>>

    /** Live window of the newest [limit] messages, oldest first. */
    fun messages(conversationId: String, limit: Int): Flow<List<ClayverMessage>>

    /** Up to [limit] messages strictly before [beforeMessageId], oldest first. */
    suspend fun olderMessages(conversationId: String, beforeMessageId: String, limit: Int): List<ClayverMessage>

    /** The shared agent read marker (`reads/{id}/agent/lastReadAt`), used for "Seen". */
    fun agentLastReadAt(conversationId: String): Flow<Long?>

    /** The customer's own read marker at the time of the call. */
    suspend fun customerLastReadAt(conversationId: String): Long?

    suspend fun send(
        text: String?,
        conversationId: String?,
        attachment: ClayverAttachmentInput?,
        clientMessageId: String,
    ): ClayverMessage

    /** Creates a new conversation with this first message. */
    suspend fun startConversation(
        text: String?,
        attachment: ClayverAttachmentInput?,
        clientMessageId: String,
    ): ClayverMessage

    /** The customer's active block, or null (see `Clayver.blockStatusFlow`). */
    fun blockStatus(): Flow<ClayverBlockStatus?>

    suspend fun markRead(conversationId: String)

    suspend fun publicConfig(): ClayverPublicConfig?

    /** A URL the UI can load or open for an attachment. */
    suspend fun attachmentUrl(storagePath: String): String
}
