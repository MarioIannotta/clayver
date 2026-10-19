package com.clayver.sdk.ui

import com.clayver.sdk.ClayverTag
import com.clayver.sdk.ClayverAgentRole
import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.ClayverBlockReason
import com.clayver.sdk.ClayverBlockStatus
import com.clayver.sdk.ClayverNote
import com.clayver.sdk.ClayverTeammate
import com.clayver.sdk.ClayverTriage
import com.clayver.sdk.ClayverTriageOption
import com.clayver.sdk.ClayverTriageOptions
import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverSenderType
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Tests the agent conversation view's state machine against [FakeAgentRepository]. */
@OptIn(ExperimentalCoroutinesApi::class)
class AgentConversationControllerTest {
    private var ids = 0

    private fun msg(id: String, type: ClayverSenderType, createdAt: Long, senderId: String = type.wireValue) =
        ClayverMessage(id = id, conversationId = "-C1", senderId = senderId, senderType = type, text = "m$id", createdAt = createdAt)

    private fun TestScope.settle() = runCurrent()
    private fun TestScope.controller(repo: FakeAgentRepository, pageSize: Int = 3) =
        AgentConversationController(repo, backgroundScope, "-C1", pageSize, clock = { 999L }, newClientMessageId = { "a_${ids++}" })

    private fun repoWithConversation(): FakeAgentRepository = FakeAgentRepository().apply {
        record("-C1").value = agentConv("-C1", customerId = "v_cust01", unread = 2)
    }

    @Test fun showsTeamPerspectiveWithDividerSeenProfileAndHistory() = runTest {
        val repo = repoWithConversation()
        repo.store("-C1").value = listOf(
            msg("-M01", ClayverSenderType.CUSTOMER, 10),
            msg("-M02", ClayverSenderType.AGENT, 20, senderId = "me"),
            msg("-M03", ClayverSenderType.CUSTOMER, 30),
            msg("-M04", ClayverSenderType.AGENT, 40, senderId = "teammate"),
            msg("-M05", ClayverSenderType.CUSTOMER, 50),
        )
        repo.agentRead = 30L
        repo.customerRead.value = 45L
        val c = controller(repo)
        settle()

        val s = c.state.value
        assertEquals(ChatPhase.Ready, s.phase)
        assertEquals("me", s.myUid)
        assertEquals("v_cust01", s.conversation?.customerId)
        assertEquals(listOf("-M03", "-M04", "-M05"), s.items.map { it.key })
        assertTrue(s.hasOlder)
        assertEquals("first customer message after the team marker", "-M05", s.unreadDividerBeforeId)
        assertEquals("newest agent message the customer read", "-M04", s.seenMessageId)
        assertEquals(CustomerName.Anonymous("cust01"), s.customerName)
        assertEquals("#112233", s.config?.accentColor)

        repo.profile("v_cust01").value = com.clayver.sdk.ClayverCustomerProfile("v_cust01", null, mapOf("name" to "Ada"), 7L)
        settle()
        assertEquals(CustomerName.Named("Ada"), c.state.value.customerName)

        c.loadOlder()
        settle()
        assertEquals(listOf("-M01", "-M02", "-M03", "-M04", "-M05"), c.state.value.items.map { it.key })
        assertFalse(c.state.value.hasOlder)

        repo.customerRead.value = 10L
        settle()
        assertNull(c.state.value.seenMessageId)
    }

    @Test fun repliesAsAgentAndReconcilesTheOptimisticMessage() = runTest {
        val repo = repoWithConversation()
        val c = controller(repo)
        settle()
        assertEquals(ChatPhase.Ready, c.state.value.phase)

        c.onDraftChange("  Hello Ada  ")
        c.send()
        // Optimistic item first, on the team's side.
        val local = c.state.value.items.single()
        assertTrue(local.isLocal)
        assertEquals(ClayverSenderType.AGENT, local.message.senderType)
        assertEquals("me", local.message.senderId)
        assertEquals("", c.state.value.draft)
        settle()

        assertEquals(listOf(Triple("-C1", "Hello Ada", "a_0")), repo.sent)
        val item = c.state.value.items.single()
        assertFalse(item.isLocal)
        assertEquals(DeliveryState.SENT, item.delivery)
        assertEquals("a_0", item.message.clientMessageId)
    }

    @Test fun failedReplyCanBeRetriedOrDiscarded() = runTest {
        val repo = repoWithConversation()
        repo.failSend = ClayverException(ClayverErrorCode.NETWORK, "offline")
        val c = controller(repo)
        settle()
        c.onDraftChange("one")
        c.send()
        settle()
        val failed = c.state.value.items.single()
        assertEquals(DeliveryState.FAILED, failed.delivery)
        assertEquals(ClayverErrorCode.NETWORK, failed.error?.code)

        repo.failSend = null
        c.retrySend(failed.key)
        settle()
        assertEquals(1, repo.sent.size)
        assertFalse(c.state.value.items.single().isLocal)

        repo.failSend = ClayverException(ClayverErrorCode.PERMISSION_DENIED, "revoked")
        c.onDraftChange("two")
        c.send()
        settle()
        val key = c.state.value.items.last().key
        c.discard(key)
        assertEquals(1, c.state.value.items.size)
    }

    @Test fun composerRejectsInvalidAttachments() = runTest {
        val repo = repoWithConversation()
        val c = controller(repo)
        settle()
        c.attach(ClayverAttachmentInput.fromBytes(ByteArray(3), "movie.mp4", "video/mp4"))
        assertEquals(ClayverErrorCode.UNSUPPORTED_ATTACHMENT_TYPE, c.state.value.composerError?.code)
        assertNull(c.state.value.pendingAttachment)
        c.attach(ClayverAttachmentInput.fromBytes(ByteArray(3), "a.png", "image/png"))
        assertTrue(c.state.value.canSend)
    }

    @Test fun closesAndReopensOptimistically() = runTest {
        val repo = repoWithConversation()
        val c = controller(repo)
        settle()
        assertFalse(c.state.value.isClosed)

        val gate = CompletableDeferred<Unit>()
        repo.actionGate = gate
        c.toggleStatus()
        assertTrue("optimistic", c.state.value.isClosed)
        assertEquals(AgentAction.CLOSE, c.state.value.action)
        c.toggleStatus() // ignored while an action is in flight
        gate.complete(Unit)
        settle()
        assertEquals(listOf("-C1" to ClayverConversationStatus.CLOSED), repo.statusWrites)
        assertNull(c.state.value.action)
        assertTrue(c.state.value.isClosed)

        repo.actionGate = null
        c.toggleStatus()
        settle()
        assertEquals(ClayverConversationStatus.OPEN, repo.statusWrites.last().second)
        assertFalse(c.state.value.isClosed)
    }

    @Test fun failedActionRevertsAndReportsTheError() = runTest {
        val repo = repoWithConversation()
        val c = controller(repo)
        settle()
        repo.failAction = ClayverException(ClayverErrorCode.PERMISSION_DENIED, "no")
        c.toggleStatus()
        settle()
        assertFalse(c.state.value.isClosed)
        assertEquals(ClayverErrorCode.PERMISSION_DENIED, c.state.value.actionError?.code)
        c.dismissActionError()
        assertNull(c.state.value.actionError)
    }

    @Test fun assignsToMeAndUnassigns() = runTest {
        val repo = repoWithConversation()
        val c = controller(repo)
        settle()
        assertEquals(Assignment.NONE, c.state.value.assignment)
        c.assign(toMe = true)
        assertEquals(Assignment.ME, c.state.value.assignment)
        settle()
        assertEquals(listOf("-C1" to true), repo.assignWrites)
        assertEquals("me", repo.record("-C1").value?.assigneeUid)

        repo.record("-C1").value = repo.record("-C1").value?.copy(assigneeUid = "teammate")
        settle()
        assertEquals(Assignment.OTHER, c.state.value.assignment)

        c.assign(toMe = false)
        settle()
        assertEquals("-C1" to false, repo.assignWrites.last())
        assertEquals(Assignment.NONE, c.state.value.assignment)
    }

    @Test fun cannotAssignToMeWithoutAUser() = runTest {
        val repo = repoWithConversation().apply { uid = null }
        val c = controller(repo)
        settle()
        c.assign(toMe = true)
        settle()
        assertTrue(repo.assignWrites.isEmpty())
    }

    @Test fun marksReadAsAgentOnlyWhileVisibleAndOncePerNewCustomerMessage() = runTest {
        val repo = repoWithConversation()
        repo.store("-C1").value = listOf(msg("-M1", ClayverSenderType.CUSTOMER, 10))
        val c = controller(repo)
        settle()
        assertTrue(repo.markedRead.isEmpty())

        c.setVisible(true)
        settle()
        assertEquals(listOf("-C1"), repo.markedRead)
        c.setVisible(true)
        settle()
        assertEquals(1, repo.markedRead.size)

        // An agent's own reply does not need a read marker.
        c.onDraftChange("reply")
        c.send()
        settle()
        assertEquals(1, repo.markedRead.size)

        repo.store("-C1").value = repo.store("-C1").value + msg("-M9", ClayverSenderType.CUSTOMER, 20_000)
        settle()
        assertEquals(2, repo.markedRead.size)

        c.setVisible(false)
        repo.store("-C1").value = repo.store("-C1").value + msg("-M99", ClayverSenderType.CUSTOMER, 30_000)
        settle()
        assertEquals(2, repo.markedRead.size)
    }

    @Test fun withoutRoleTheViewFailsWithPermissionDenied() = runTest {
        val repo = repoWithConversation().apply { isAgent = false }
        val c = controller(repo)
        settle()
        val phase = c.state.value.phase as ChatPhase.Failed
        assertEquals(ClayverErrorCode.PERMISSION_DENIED, phase.error.code)
        repo.isAgent = true
        c.retry()
        settle()
        assertEquals(ChatPhase.Ready, c.state.value.phase)
    }

    @Test fun togglesTagsOptimisticallyAndRevertsOnFailure() = runTest {
        val repo = repoWithConversation()
        repo.catalog.value = listOf(ClayverTag("bug", "Bug", "#EA580C"), ClayverTag("urgent", "Urgent", "#DC2626"))
        repo.conversationTagIds("-C1").value = listOf("urgent")
        val c = controller(repo)
        settle()
        assertEquals(listOf("urgent"), c.state.value.tags.map { it.id })

        repo.tagGate = CompletableDeferred()
        c.toggleTag("bug")
        assertEquals("shown before the write completes", listOf("bug", "urgent"), c.state.value.tags.map { it.id })
        repo.tagGate!!.complete(Unit)
        settle()
        assertEquals(Triple("-C1", "bug", true), repo.tagWrites.last())
        assertEquals(listOf("bug", "urgent"), c.state.value.tagIds.sorted())

        repo.tagGate = null
        repo.failTagWrite = ClayverException(ClayverErrorCode.PERMISSION_DENIED, "no")
        c.toggleTag("urgent")
        settle()
        assertEquals(ClayverErrorCode.PERMISSION_DENIED, c.state.value.actionError?.code)
        assertEquals("reverted", listOf("bug", "urgent"), c.state.value.tagIds.sorted())
    }

    @Test fun createsATagAndAddsItToTheConversation() = runTest {
        val repo = repoWithConversation()
        repo.catalog.value = listOf(ClayverTag("urgent", "Urgent", "#DC2626"))
        val c = controller(repo)
        settle()

        c.createTag("  Refund request ")
        settle()
        assertEquals(listOf("  Refund request "), repo.createdTags)
        assertFalse(c.state.value.creatingTag)
        assertEquals("added to the catalog before the listener catches up", listOf("refund-request", "urgent"), c.state.value.tagCatalog.map { it.id })
        assertEquals(listOf("refund-request"), c.state.value.tags.map { it.id })
        assertEquals(Triple("-C1", "refund-request", true), repo.tagWrites.last())

        // An existing slug is reused and not added twice.
        c.createTag("refund REQUEST")
        settle()
        assertEquals(1, repo.tagWrites.size)
    }

    @Test fun setsPriorityAndStatusOptimisticallyAndRevertsOnFailure() = runTest {
        val repo = repoWithConversation()
        repo.triageOf("-C1").value = ClayverTriage(priority = "low", stage = "gone")
        val c = controller(repo)
        settle()
        assertEquals("low", c.state.value.priority?.id)
        assertNull("a value not in the list shows as none", c.state.value.stage)

        repo.triageGate = CompletableDeferred()
        c.setPriority("high")
        settle()
        assertEquals("shown before the write lands", "high", c.state.value.priority?.id)
        repo.triageGate!!.complete(Unit)
        settle()
        assertEquals(Triple("-C1", "priority", "high"), repo.triageWrites.last())
        assertEquals("high", c.state.value.triage.priority)

        c.setStage("todo")
        c.setPriority(null)
        settle()
        assertEquals("To do", c.state.value.stage?.name)
        assertNull(c.state.value.priority)
        assertEquals(Triple("-C1", "priority", null), repo.triageWrites.last())

        repo.triageGate = null
        repo.failTriage = ClayverException(ClayverErrorCode.PERMISSION_DENIED, "no")
        c.setStage("on_hold")
        settle()
        assertEquals(ClayverErrorCode.PERMISSION_DENIED, c.state.value.actionError?.code)
        assertEquals("reverted to the live value", "todo", c.state.value.triage.stage)
    }

    @Test fun usesTheWorkspaceTriageLists() = runTest {
        val repo = repoWithConversation()
        repo.triageOptionsFlow.value = ClayverTriageOptions(
            priority = listOf(ClayverTriageOption("p1", "P1", "#FF0000", 0)),
        )
        repo.triageOf("-C1").value = ClayverTriage(priority = "high")
        val c = controller(repo)
        settle()
        assertNull("high is not in the workspace list", c.state.value.priority)
        assertEquals(ClayverTriageOptions.DEFAULT_STAGE, c.state.value.triageOptions.stage)
    }

    @Test fun addsAndDeletesNotes() = runTest {
        val repo = repoWithConversation()
        repo.notesOf("-C1").value = listOf(ClayverNote("-N1", "-C1", "teammate", "Bo", "Older", 5L))
        val c = controller(repo)
        settle()
        val teammateNote = c.state.value.notes.single()
        assertFalse("agents delete only their own notes", c.state.value.canDelete(teammateNote))

        c.addNote()
        settle()
        assertEquals("blank drafts are ignored", 1, c.state.value.notes.size)

        c.onNoteDraftChange("  Called the customer  ")
        c.addNote()
        settle()
        val s = c.state.value
        assertEquals("", s.noteDraft)
        assertFalse(s.addingNote)
        assertEquals("newest first", listOf("Called the customer", "Older"), s.notes.map { it.text })
        assertTrue(s.canDelete(s.notes.first()))

        c.deleteNote(s.notes.first().id)
        settle()
        assertEquals(listOf("Older"), c.state.value.visibleNotes.map { it.text })

        repo.failNote = ClayverException(ClayverErrorCode.NETWORK, "offline")
        c.onNoteDraftChange("Keep me")
        c.addNote()
        settle()
        assertEquals("draft kept on failure", "Keep me", c.state.value.noteDraft)
        assertEquals(ClayverErrorCode.NETWORK, c.state.value.actionError?.code)
    }

    @Test fun adminsMayDeleteAnyNote() = runTest {
        val repo = repoWithConversation()
        repo.role = ClayverAgentRole.ADMIN
        repo.notesOf("-C1").value = listOf(ClayverNote("-N1", "-C1", "teammate", null, "Hi", 5L))
        val c = controller(repo)
        settle()
        assertTrue(c.state.value.canDelete(c.state.value.notes.single()))
    }

    @Test fun showsAssigneeNameCustomerConversationsAndBlocks() = runTest {
        val repo = repoWithConversation()
        repo.record("-C1").value = agentConv("-C1", customerId = "v_cust01", assignee = "bo")
        repo.teamFlow.value = listOf(ClayverTeammate("bo", "Bo", "bo@example.com", ClayverAgentRole.AGENT, true))
        repo.customerConversationsOf("v_cust01").value = listOf(agentConv("-C2", customerId = "v_cust01"), agentConv("-C1", customerId = "v_cust01"))
        val c = controller(repo)
        settle()
        assertEquals("Bo", c.state.value.assigneeName)
        assertEquals(listOf("-C2", "-C1"), c.state.value.customerConversations.map { it.id })
        assertNull(c.state.value.block)

        c.blockCustomer(ClayverBlockReason.SPAM, 1_000L)
        settle()
        assertEquals(Triple("v_cust01", ClayverBlockReason.SPAM, 1_999L), repo.blockWrites.last())
        assertEquals(ClayverBlockStatus(ClayverBlockReason.SPAM, 1_999L), c.state.value.block)
        assertFalse(c.state.value.blockBusy)

        c.unblockCustomer()
        settle()
        assertNull(c.state.value.block)

        repo.failBlock = ClayverException(ClayverErrorCode.PERMISSION_DENIED, "no")
        c.blockCustomer(ClayverBlockReason.ABUSE, null)
        settle()
        assertNull("reverted", c.state.value.block)
        assertEquals(ClayverErrorCode.PERMISSION_DENIED, c.state.value.actionError?.code)
    }
}
