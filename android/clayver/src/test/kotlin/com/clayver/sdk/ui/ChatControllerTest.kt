package com.clayver.sdk.ui

import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.ClayverBlockReason
import com.clayver.sdk.ClayverBlockStatus
import com.clayver.sdk.ClayverConversation
import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverPublicConfig
import com.clayver.sdk.ClayverSenderType
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Tests the chat view model's state machine ([ChatController]) against a fake repository. */
@OptIn(ExperimentalCoroutinesApi::class)
class ChatControllerTest {

    private class FakeRepository : ChatRepository {
        val conversations = MutableStateFlow<List<ClayverConversation>>(emptyList())
        val messagesByConversation = mutableMapOf<String, MutableStateFlow<List<ClayverMessage>>>()
        val agentRead = MutableStateFlow<Long?>(null)
        var customerRead: Long? = null
        var failMessages: ClayverException? = null
        var failSend: ClayverException? = null
        var sendGate: CompletableDeferred<Unit>? = null
        val sent = mutableListOf<Pair<String?, String?>>()
        val markedRead = mutableListOf<String>()
        val started = mutableListOf<String?>()
        val block = MutableStateFlow<ClayverBlockStatus?>(null)
        var nextId = 100
        var olderRequests = mutableListOf<String>()

        fun store(id: String) = messagesByConversation.getOrPut(id) { MutableStateFlow(emptyList()) }

        override fun conversations(): Flow<List<ClayverConversation>> = conversations

        override fun messages(conversationId: String, limit: Int): Flow<List<ClayverMessage>> {
            failMessages?.let { e -> return flow { throw e } }
            return store(conversationId).map { it.sortedBy(ClayverMessage::id).takeLast(limit) }
        }

        override suspend fun olderMessages(conversationId: String, beforeMessageId: String, limit: Int): List<ClayverMessage> {
            olderRequests += beforeMessageId
            return store(conversationId).value.filter { it.id < beforeMessageId }.sortedBy { it.id }.takeLast(limit)
        }

        override fun agentLastReadAt(conversationId: String): Flow<Long?> = agentRead
        override suspend fun customerLastReadAt(conversationId: String): Long? = customerRead

        override suspend fun send(text: String?, conversationId: String?, attachment: ClayverAttachmentInput?, clientMessageId: String): ClayverMessage {
            sendGate?.await()
            failSend?.let { throw it }
            val conv = conversationId ?: "-Cnew"
            sent += conversationId to text
            val msg = ClayverMessage(
                id = "-M${nextId++}", conversationId = conv, senderId = "cid", senderType = ClayverSenderType.CUSTOMER,
                text = text, createdAt = 1_000L + nextId, clientMessageId = clientMessageId,
            )
            store(conv).value = store(conv).value + msg
            return msg
        }

        override suspend fun startConversation(text: String?, attachment: ClayverAttachmentInput?, clientMessageId: String): ClayverMessage {
            sendGate?.await()
            failSend?.let { throw it }
            val conv = "-Cstarted${started.size}"
            started += text
            val msg = ClayverMessage(
                id = "-M${nextId++}", conversationId = conv, senderId = "cid", senderType = ClayverSenderType.CUSTOMER,
                text = text, createdAt = 1_000L + nextId, clientMessageId = clientMessageId,
            )
            store(conv).value = store(conv).value + msg
            return msg
        }

        override fun blockStatus(): Flow<ClayverBlockStatus?> = block

        override suspend fun markRead(conversationId: String) {
            markedRead += conversationId
        }

        override suspend fun publicConfig(): ClayverPublicConfig = ClayverPublicConfig(teamName = "Acme", welcomeMessage = "Hi there")
        override suspend fun attachmentUrl(storagePath: String): String = "https://example/$storagePath"
    }

    private fun msg(id: String, type: ClayverSenderType, createdAt: Long, conv: String = "-C1") =
        ClayverMessage(id = id, conversationId = conv, senderId = type.wireValue, senderType = type, text = "m$id", createdAt = createdAt)

    private fun conv(id: String, status: ClayverConversationStatus, updatedAt: Long) =
        ClayverConversation(id, status, 0L, updatedAt, null, 0)

    private var ids = 0

    /** Runs all ready tasks, including the controller's backgroundScope coroutines (advanceUntilIdle skips those). */
    private fun TestScope.settle() = runCurrent()
    private fun TestScope.controller(
        repo: FakeRepository,
        conversationId: String? = null,
        pageSize: Int = 3,
        newConversation: Boolean = false,
    ) = ChatController(
        repo, backgroundScope, conversationId, pageSize, clock = { 999L }, newClientMessageId = { "a_${ids++}" },
        newConversation = newConversation,
    )

    @Test fun newChatIgnoresOpenConversationsAndStartsOneOnFirstSend() = runTest {
        val repo = FakeRepository()
        repo.conversations.value = listOf(conv("-C1", ClayverConversationStatus.OPEN, 40))
        repo.store("-C1").value = listOf(msg("-M01", ClayverSenderType.AGENT, 10))
        val c = controller(repo, newConversation = true)
        settle()
        assertTrue("an empty chat, not the open conversation", c.state.value.isEmpty)
        assertNull(c.state.value.conversationId)
        assertTrue("nothing is written before the first send", repo.started.isEmpty() && repo.sent.isEmpty())

        repo.sendGate = CompletableDeferred()
        c.onDraftChange("First")
        c.send()
        c.onDraftChange("Second")
        c.send()
        repo.sendGate!!.complete(Unit)
        settle()
        assertEquals("one new conversation for a burst of sends", listOf<String?>("First"), repo.started)
        assertEquals(listOf<Pair<String?, String?>>("-Cstarted0" to "Second"), repo.sent)
        assertEquals("-Cstarted0", c.state.value.conversationId)
        assertEquals(listOf("First", "Second"), c.state.value.items.map { it.message.text })
        assertTrue(c.state.value.items.all { it.delivery == DeliveryState.SENT })
    }

    @Test fun blockedCustomerCannotSendUntilTheBlockEnds() = runTest {
        val repo = FakeRepository()
        val c = controller(repo, "-C1")
        settle()
        repo.block.value = ClayverBlockStatus(ClayverBlockReason.SPAM, until = 5_000L)
        settle()
        assertEquals(ClayverBlockReason.SPAM, c.state.value.blocked?.reason)
        c.onDraftChange("hello")
        c.send()
        settle()
        assertTrue(repo.sent.isEmpty())
        assertEquals("the draft is kept", "hello", c.state.value.draft)

        repo.block.value = null
        settle()
        assertNull(c.state.value.blocked)
        c.send()
        settle()
        assertEquals(listOf<Pair<String?, String?>>("-C1" to "hello"), repo.sent)
    }

    @Test fun showsLatestOpenConversationWithHistoryDividerAndSeen() = runTest {
        val repo = FakeRepository()
        repo.conversations.value = listOf(conv("-C2", ClayverConversationStatus.CLOSED, 50), conv("-C1", ClayverConversationStatus.OPEN, 40))
        repo.store("-C1").value = listOf(
            msg("-M01", ClayverSenderType.CUSTOMER, 10),
            msg("-M02", ClayverSenderType.AGENT, 20),
            msg("-M03", ClayverSenderType.CUSTOMER, 30),
            msg("-M04", ClayverSenderType.AGENT, 40),
            msg("-M05", ClayverSenderType.CUSTOMER, 50),
        )
        repo.customerRead = 20
        repo.agentRead.value = 35

        val c = controller(repo)
        settle()

        val s = c.state.value
        assertEquals(ChatPhase.Ready, s.phase)
        assertEquals("-C1", s.conversationId)
        assertEquals(listOf("-M03", "-M04", "-M05"), s.items.map { it.key })
        assertTrue(s.hasOlder)
        assertEquals("-M04", s.unreadDividerBeforeId)
        assertEquals("-M03", s.seenMessageId)
        assertEquals("Acme", s.config?.teamName)

        c.loadOlder()
        settle()
        assertEquals(listOf("-M03"), repo.olderRequests)
        assertEquals(listOf("-M01", "-M02", "-M03", "-M04", "-M05"), c.state.value.items.map { it.key })
        assertFalse(c.state.value.hasOlder)

        repo.agentRead.value = 60
        settle()
        assertEquals("-M05", c.state.value.seenMessageId)
    }

    @Test fun marksReadOnlyWhileVisibleAndOncePerNewAgentMessage() = runTest {
        val repo = FakeRepository()
        repo.store("-C1").value = listOf(msg("-M1", ClayverSenderType.AGENT, 10))
        val c = controller(repo, "-C1")
        settle()
        assertTrue(repo.markedRead.isEmpty())

        c.setVisible(true)
        settle()
        assertEquals(listOf("-C1"), repo.markedRead)

        c.setVisible(true)
        settle()
        assertEquals(1, repo.markedRead.size)

        repo.store("-C1").value = repo.store("-C1").value + msg("-M2", ClayverSenderType.AGENT, 20)
        settle()
        assertEquals(2, repo.markedRead.size)

        c.setVisible(false)
        repo.store("-C1").value = repo.store("-C1").value + msg("-M3", ClayverSenderType.AGENT, 30)
        settle()
        assertEquals(2, repo.markedRead.size)
    }

    @Test fun firstSendCreatesConversationAndReconcilesOptimisticMessage() = runTest {
        val repo = FakeRepository()
        val c = controller(repo)
        settle()
        assertTrue(c.state.value.isEmpty)
        assertNull(c.state.value.conversationId)

        repo.sendGate = CompletableDeferred()
        c.onDraftChange("  Hello  ")
        c.send()
        // Optimistic item is visible immediately and the composer is cleared.
        assertEquals("", c.state.value.draft)
        assertEquals(DeliveryState.SENDING, c.state.value.items.single().delivery)
        assertEquals("Hello", c.state.value.items.single().message.text)

        repo.sendGate!!.complete(Unit)
        settle()
        val s = c.state.value
        assertEquals("-Cnew", s.conversationId)
        assertEquals(listOf(null to "Hello"), repo.sent)
        assertEquals(1, s.items.size)
        assertEquals(DeliveryState.SENT, s.items.single().delivery)
        assertEquals("a_0", s.items.single().message.clientMessageId)

        c.onDraftChange("Second")
        c.send()
        settle()
        assertEquals("-Cnew", repo.sent.last().first)
        assertEquals(2, c.state.value.items.size)
    }

    @Test fun failedSendCanBeRetriedOrDiscarded() = runTest {
        val repo = FakeRepository()
        val c = controller(repo, "-C1")
        settle()

        repo.failSend = ClayverException(ClayverErrorCode.NETWORK, "offline")
        c.onDraftChange("hi")
        c.send()
        settle()
        val failed = c.state.value.items.single()
        assertEquals(DeliveryState.FAILED, failed.delivery)
        assertEquals(ClayverErrorCode.NETWORK, failed.error?.code)

        repo.failSend = null
        c.retrySend(failed.key)
        settle()
        assertEquals(DeliveryState.SENT, c.state.value.items.single().delivery)

        repo.failSend = ClayverException(ClayverErrorCode.PERMISSION_DENIED, "no")
        c.onDraftChange("again")
        c.send()
        settle()
        val key = c.state.value.items.last().key
        c.discard(key)
        assertEquals(1, c.state.value.items.size)
    }

    @Test fun rejectsInvalidAttachmentsInComposer() = runTest {
        val repo = FakeRepository()
        val c = controller(repo, "-C1")
        settle()
        c.attach(ClayverAttachmentInput.fromBytes(ByteArray(3), "movie.mp4", "video/mp4"))
        assertEquals(ClayverErrorCode.UNSUPPORTED_ATTACHMENT_TYPE, c.state.value.composerError?.code)
        assertNull(c.state.value.pendingAttachment)
        assertFalse(c.state.value.canSend)

        // Raw images are compressed before upload, so only sources over 30 MiB are rejected up front.
        c.attach(ClayverAttachmentInput.fromStream("big.png", "image/png", 31L * 1024 * 1024) { error("unused") })
        assertEquals(ClayverErrorCode.ATTACHMENT_TOO_LARGE, c.state.value.composerError?.code)

        c.attach(ClayverAttachmentInput.fromBytes(ByteArray(3), "ok.png", "image/png"))
        assertNull(c.state.value.composerError)
        assertTrue(c.state.value.canSend)
        c.send()
        settle()
        assertEquals(listOf("-C1" to null), repo.sent)
        assertNull(c.state.value.pendingAttachment)
    }

    @Test fun loadErrorShowsFailedPhaseAndRetryRecovers() = runTest {
        val repo = FakeRepository()
        repo.failMessages = ClayverException(ClayverErrorCode.PERMISSION_DENIED, "denied")
        val c = controller(repo, "-C1")
        settle()
        val phase = c.state.value.phase
        assertTrue(phase is ChatPhase.Failed)
        assertEquals(ClayverErrorCode.PERMISSION_DENIED, (phase as ChatPhase.Failed).error.code)

        repo.failMessages = null
        repo.store("-C1").value = listOf(msg("-M1", ClayverSenderType.AGENT, 1))
        c.retry()
        settle()
        assertEquals(ChatPhase.Ready, c.state.value.phase)
        assertEquals(1, c.state.value.items.size)
    }
}
