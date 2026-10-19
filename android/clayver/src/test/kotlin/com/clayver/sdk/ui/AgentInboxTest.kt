package com.clayver.sdk.ui

import com.clayver.sdk.ClayverTag
import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.ClayverCustomerAccount
import com.clayver.sdk.ClayverCustomerProfile
import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverLastMessage
import com.clayver.sdk.ClayverSenderType
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale
import java.util.TimeZone

@OptIn(ExperimentalCoroutinesApi::class)
class AgentInboxTest {
    private val utc = TimeZone.getTimeZone("UTC")

    private fun profile(cid: String, name: String? = null, email: String? = null) =
        ClayverCustomerProfile(
            cid,
            email?.let { ClayverCustomerAccount(anonymous = false, email = it, emailVerified = true, displayName = null) },
            if (name != null) mapOf("name" to name) else emptyMap(),
            null,
        )

    @Test fun customerNamePrefersNameThenAccountThenShortId() {
        assertEquals(CustomerName.Named("Ada"), AgentInboxFormatting.customerName("u1", profile("u1", " Ada ", "ada@example.com")))
        assertEquals(CustomerName.Named("ada@example.com"), AgentInboxFormatting.customerName("u1", profile("u1", email = "ada@example.com")))
        assertEquals(CustomerName.Anonymous("9f8e7d"), AgentInboxFormatting.customerName("9f8e7d6c5b", profile("9f8e7d6c5b")))
        assertEquals(CustomerName.Anonymous("AnonUi"), AgentInboxFormatting.customerName("AnonUid123", null))
    }

    @Test fun mapsRowsNewestFirstWithUnreadAssignmentAndPreview() {
        val last = ClayverLastMessage("line one\nline two", ClayverSenderType.CUSTOMER, 30L, hasAttachment = false)
        val conversations = listOf(
            agentConv("-C1", customerId = "a", updatedAt = 10L, assignee = "someone"),
            agentConv("-C3", customerId = "b", updatedAt = 30L, unread = 3, assignee = "me").copy(lastMessage = last),
            agentConv("-C2", customerId = "c", updatedAt = 30L),
            agentConv("-C2", customerId = "c", updatedAt = 30L), // duplicate key from a racing update
        )
        val rows = AgentInboxFormatting.rows(conversations, mapOf("b" to profile("b", "Bea")), myUid = "me")
        assertEquals(listOf("-C3", "-C2", "-C1"), rows.map { it.conversationId })
        val top = rows[0]
        assertEquals(CustomerName.Named("Bea"), top.customerName)
        assertEquals(3, top.unread)
        assertEquals(Assignment.ME, top.assignment)
        assertEquals("line one line two", top.preview?.text)
        assertEquals(Assignment.NONE, rows[1].assignment)
        assertEquals(null, rows[1].preview)
        assertEquals(Assignment.OTHER, rows[2].assignment)
        assertEquals(Assignment.OTHER, AgentInboxFormatting.assignment("x", myUid = null))
    }

    @Test fun relativeTimes() {
        val now = 1_700_000_000_000L // 2023-11-14 22:13 UTC
        fun rel(ago: Long) = AgentInboxFormatting.relativeTime(now - ago, now, utc, Locale.US)
        assertEquals(RelativeTime.JustNow, rel(30_000))
        assertEquals(RelativeTime.JustNow, AgentInboxFormatting.relativeTime(now + 5_000, now, utc, Locale.US))
        assertEquals(RelativeTime.Minutes(5), rel(5 * 60_000))
        assertEquals(RelativeTime.Hours(3), rel(3 * 3_600_000))
        assertEquals(RelativeTime.Yesterday, rel(23 * 3_600_000))
        assertEquals(RelativeTime.Date("11/10/23"), rel(4 * 86_400_000L))
    }

    private fun TestScope.settle() = runCurrent()

    @Test fun inboxLoadsTabsAndResolvesCustomerNames() = runTest {
        val repo = FakeAgentRepository()
        repo.inbox.getValue(ClayverConversationStatus.OPEN).value = listOf(
            agentConv("-C1", customerId = "a", updatedAt = 10),
            agentConv("-C2", customerId = "b", updatedAt = 20, unread = 1),
        )
        repo.inbox.getValue(ClayverConversationStatus.CLOSED).value = listOf(
            agentConv("-C9", customerId = "z", status = ClayverConversationStatus.CLOSED, updatedAt = 5),
        )
        val c = AgentInboxController(repo, backgroundScope)
        assertEquals(InboxPhase.Loading, c.state.value.phase)
        settle()
        assertEquals(InboxPhase.Ready, c.state.value.phase)
        assertEquals(listOf("-C2", "-C1"), c.state.value.rows.map { it.conversationId })
        assertEquals(CustomerName.Anonymous("b"), c.state.value.rows[0].customerName)

        repo.profile("b").value = profile("b", "Bea")
        settle()
        assertEquals(CustomerName.Named("Bea"), c.state.value.rows[0].customerName)

        // Live updates: a new conversation arrives on top.
        repo.inbox.getValue(ClayverConversationStatus.OPEN).value =
            repo.inbox.getValue(ClayverConversationStatus.OPEN).value + agentConv("-C3", customerId = "b", updatedAt = 40)
        settle()
        assertEquals(listOf("-C3", "-C2", "-C1"), c.state.value.rows.map { it.conversationId })
        assertEquals("one listener per customer", 1, repo.profileSubscriptions.count { it == "b" })

        c.selectTab(ClayverConversationStatus.CLOSED)
        assertEquals(ClayverConversationStatus.CLOSED, c.state.value.tab)
        settle()
        assertEquals(listOf("-C9"), c.state.value.rows.map { it.conversationId })

        repo.inbox.getValue(ClayverConversationStatus.CLOSED).value = emptyList()
        settle()
        assertTrue(c.state.value.isEmpty)
    }

    @Test fun inboxWithoutRoleFailsWithPermissionDeniedAndRetryRecovers() = runTest {
        val repo = FakeAgentRepository().apply { isAgent = false }
        val c = AgentInboxController(repo, backgroundScope)
        settle()
        val phase = c.state.value.phase as InboxPhase.Failed
        assertEquals(ClayverErrorCode.PERMISSION_DENIED, phase.error.code)

        repo.isAgent = true
        c.retry()
        settle()
        assertEquals(InboxPhase.Ready, c.state.value.phase)
        assertTrue(c.state.value.isEmpty)
    }

    @Test fun tagFilterQueriesTheTagAndResetsWhenTheTagIsDeleted() = runTest {
        val repo = FakeAgentRepository()
        repo.inbox.getValue(ClayverConversationStatus.OPEN).value = listOf(
            agentConv("-C1", updatedAt = 10),
            agentConv("-C2", updatedAt = 20),
        )
        repo.tagged["bug"] = setOf("-C1")
        repo.catalog.value = listOf(ClayverTag("bug", "Bug", "#EA580C"), ClayverTag("urgent", "Urgent", "#DC2626"))
        val c = AgentInboxController(repo, backgroundScope)
        settle()
        assertEquals(listOf("bug", "urgent"), c.state.value.tags.map { it.id })
        assertEquals(listOf("-C2", "-C1"), c.state.value.rows.map { it.conversationId })

        c.selectTag("bug")
        settle()
        assertEquals("bug", c.state.value.tagFilter)
        assertEquals(ClayverConversationStatus.OPEN to "bug", repo.conversationRequests.last())
        assertEquals(listOf("-C1"), c.state.value.rows.map { it.conversationId })

        c.selectTab(ClayverConversationStatus.CLOSED)
        settle()
        assertEquals("the filter applies to both tabs", ClayverConversationStatus.CLOSED to "bug", repo.conversationRequests.last())

        repo.catalog.value = listOf(ClayverTag("urgent", "Urgent", "#DC2626"))
        settle()
        assertNull(c.state.value.tagFilter)
        assertEquals(ClayverConversationStatus.CLOSED to null, repo.conversationRequests.last())
    }
}
