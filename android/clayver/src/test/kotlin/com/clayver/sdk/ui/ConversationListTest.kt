package com.clayver.sdk.ui

import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.ClayverBlockStatus
import com.clayver.sdk.ClayverConversation
import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverLastMessage
import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverPublicConfig
import com.clayver.sdk.ClayverSenderType
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ConversationListTest {
    private fun conv(
        id: String,
        updatedAt: Long,
        status: ClayverConversationStatus = ClayverConversationStatus.OPEN,
        last: ClayverLastMessage? = null,
        unread: Int = 0,
    ) = ClayverConversation(id, status, 0L, updatedAt, last, unread)

    @Test fun rowsAreNewestFirstWithPreviewTimeAndUnread() {
        val rows = ConversationListFormatting.rows(
            listOf(
                conv("-C1", 10, ClayverConversationStatus.CLOSED, ClayverLastMessage("Thanks!\nBye", ClayverSenderType.CUSTOMER, 9, false)),
                conv("-C3", 30, last = ClayverLastMessage(null, ClayverSenderType.AGENT, 28, hasAttachment = true), unread = 2),
                conv("-C2", 30),
                conv("-C2", 30), // duplicate key from a racing update
            ),
        )
        assertEquals(listOf("-C3", "-C2", "-C1"), rows.map { it.conversationId })
        assertEquals(ConversationPreview.Attachment(fromCustomer = false), rows[0].preview)
        assertEquals("time of the last message", 28L, rows[0].time)
        assertEquals(2, rows[0].unread)
        assertNull("no messages yet", rows[1].preview)
        assertEquals("falls back to updatedAt", 30L, rows[1].time)
        assertEquals(ConversationPreview.Text("Thanks! Bye", fromCustomer = true), rows[2].preview)
    }

    @Test fun blankTextWithoutAttachmentHasNoPreview() {
        assertNull(ConversationListFormatting.preview(conv("-C", 1, last = ClayverLastMessage("  ", ClayverSenderType.AGENT, 1, false))))
        assertEquals(
            ConversationPreview.Attachment(fromCustomer = true),
            ConversationListFormatting.preview(conv("-C", 1, last = ClayverLastMessage(" ", ClayverSenderType.CUSTOMER, 1, true))),
        )
    }

    @Test fun routingWithMultipleConversations() {
        fun stack(entry: ChatEntry, id: String? = null, has: Boolean? = null) =
            ConversationRouting.initialStack(entry, id, multipleConversations = true, hasConversations = has)
        assertTrue(ConversationRouting.needsConversationCount(ChatEntry.DEFAULT, null, true))
        assertNull("waits for the conversation count", stack(ChatEntry.DEFAULT))
        assertEquals(listOf(ChatDestination.List), stack(ChatEntry.DEFAULT, has = true))
        assertEquals("a first chat opens over the list, so back leads to it", listOf(ChatDestination.List, ChatDestination.New(0)), stack(ChatEntry.DEFAULT, has = false))
        assertEquals("a push opens the conversation over the list", listOf(ChatDestination.List, ChatDestination.Conversation("-C1")), stack(ChatEntry.DEFAULT, "-C1"))
        assertFalse(ConversationRouting.needsConversationCount(ChatEntry.DEFAULT, "-C1", true))
        assertEquals(listOf(ChatDestination.List), stack(ChatEntry.LIST))
        assertEquals(listOf(ChatDestination.List, ChatDestination.New(0)), stack(ChatEntry.NEW))
    }

    @Test fun routingWithASingleConversation() {
        fun stack(entry: ChatEntry, id: String? = null) =
            ConversationRouting.initialStack(entry, id, multipleConversations = false, hasConversations = null)
        assertFalse(ConversationRouting.needsConversationCount(ChatEntry.DEFAULT, null, false))
        assertEquals(listOf(ChatDestination.Latest), stack(ChatEntry.DEFAULT))
        assertEquals(listOf(ChatDestination.Conversation("-C1")), stack(ChatEntry.DEFAULT, "-C1"))
        assertEquals("openConversations still works", listOf(ChatDestination.List), stack(ChatEntry.LIST))
        assertEquals(listOf(ChatDestination.New(0)), stack(ChatEntry.NEW))
    }

    @Test fun destinationsSurviveSavedState() {
        val all = listOf(ChatDestination.List, ChatDestination.Latest, ChatDestination.New(7), ChatDestination.Conversation("-Nx_1"))
        assertEquals(all, all.map { ConversationRouting.decode(ConversationRouting.encode(it)) })
        assertNull(ConversationRouting.decode("c:bad/id"))
        assertNull(ConversationRouting.decode("new:x"))
        assertNull(ConversationRouting.decode("other"))
    }

    private class ListRepository : ChatRepository {
        val conversations = MutableStateFlow<List<ClayverConversation>>(emptyList())
        var fail: ClayverException? = null
        override fun conversations(): Flow<List<ClayverConversation>> {
            fail?.let { e -> return flow { throw e } }
            return conversations
        }
        override fun messages(conversationId: String, limit: Int): Flow<List<ClayverMessage>> = emptyFlow()
        override suspend fun olderMessages(conversationId: String, beforeMessageId: String, limit: Int) = emptyList<ClayverMessage>()
        override fun agentLastReadAt(conversationId: String): Flow<Long?> = emptyFlow()
        override suspend fun customerLastReadAt(conversationId: String): Long? = null
        override suspend fun send(text: String?, conversationId: String?, attachment: ClayverAttachmentInput?, clientMessageId: String): ClayverMessage =
            error("unused")
        override suspend fun startConversation(text: String?, attachment: ClayverAttachmentInput?, clientMessageId: String): ClayverMessage =
            error("unused")
        override fun blockStatus(): Flow<ClayverBlockStatus?> = flowOf(null)
        override suspend fun markRead(conversationId: String) = Unit
        override suspend fun publicConfig(): ClayverPublicConfig = ClayverPublicConfig(teamName = "Acme")
        override suspend fun attachmentUrl(storagePath: String): String = storagePath
    }

    @Test fun controllerFollowsTheInboxAndRecoversFromErrors() = runTest {
        val repo = ListRepository()
        repo.fail = ClayverException(ClayverErrorCode.NETWORK, "offline")
        val c = ConversationListController(repo, backgroundScope)
        runCurrent()
        assertEquals(ClayverErrorCode.NETWORK, (c.state.value.phase as InboxPhase.Failed).error.code)
        assertEquals("Acme", c.state.value.config?.teamName)

        repo.fail = null
        c.retry()
        runCurrent()
        assertTrue(c.state.value.isEmpty)

        repo.conversations.value = listOf(conv("-C1", 1), conv("-C2", 2))
        runCurrent()
        assertEquals(listOf("-C2", "-C1"), c.state.value.rows.map { it.conversationId })
    }
}
