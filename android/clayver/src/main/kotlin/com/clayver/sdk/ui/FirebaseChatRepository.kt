package com.clayver.sdk.ui

import com.clayver.sdk.Clayver
import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.ClayverBlockStatus
import com.clayver.sdk.ClayverConversation
import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverPublicConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow

/** [ChatRepository] backed by the configured Clayver instance (waits for configure if needed). */
internal class FirebaseChatRepository : ChatRepository {
    override fun conversations(): Flow<List<ClayverConversation>> = Clayver.conversationsFlow()

    override fun messages(conversationId: String, limit: Int): Flow<List<ClayverMessage>> =
        Clayver.messagesFlow(conversationId, limit)

    override suspend fun olderMessages(conversationId: String, beforeMessageId: String, limit: Int): List<ClayverMessage> =
        Clayver.loadOlderMessages(conversationId, beforeMessageId, limit)

    override fun agentLastReadAt(conversationId: String): Flow<Long?> =
        flow { emitAll(Clayver.core().agentLastReadAtFlow(conversationId)) }

    override suspend fun customerLastReadAt(conversationId: String): Long? =
        Clayver.core().customerLastReadAt(conversationId)

    override suspend fun send(
        text: String?,
        conversationId: String?,
        attachment: ClayverAttachmentInput?,
        clientMessageId: String,
    ): ClayverMessage = Clayver.core().sendMessage(text, conversationId, attachment, clientMessageId)

    override suspend fun startConversation(
        text: String?,
        attachment: ClayverAttachmentInput?,
        clientMessageId: String,
    ): ClayverMessage = Clayver.core().startConversation(text, attachment, clientMessageId)

    override fun blockStatus(): Flow<ClayverBlockStatus?> = Clayver.blockStatusFlow()

    override suspend fun markRead(conversationId: String) = Clayver.markConversationRead(conversationId)

    override suspend fun publicConfig(): ClayverPublicConfig = Clayver.core().publicConfig()

    override suspend fun attachmentUrl(storagePath: String): String = Clayver.core().attachmentUrl(storagePath)
}
