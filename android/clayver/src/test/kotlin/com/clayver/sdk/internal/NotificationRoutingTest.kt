package com.clayver.sdk.internal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationRoutingTest {
    private fun push(audience: String?, projectId: String? = "default") = buildMap<String, Any?> {
        put("clayver", "1")
        put("type", "message")
        put("conversationId", "-Nx")
        projectId?.let { put("projectId", it) }
        audience?.let { put("audience", it) }
    }

    @Test fun routesByAudience() {
        assertEquals(PushDestination.CustomerChat("-Nx"), NotificationRouting.destination(push("customer"), "default"))
        assertEquals(PushDestination.AgentConversation("-Nx"), NotificationRouting.destination(push("agent"), "default"))
        // Pushes from before agent mode (no audience) and unknown audiences go to the customer chat.
        assertEquals(PushDestination.CustomerChat("-Nx"), NotificationRouting.destination(push(null), "default"))
        assertEquals(PushDestination.CustomerChat("-Nx"), NotificationRouting.destination(push("admin"), "default"))
    }

    @Test fun parsesAudience() {
        assertEquals(PushAudience.AGENT, NotificationPayload.parse(push("agent"))!!.audience)
        assertEquals(PushAudience.CUSTOMER, NotificationPayload.parse(push(null))!!.audience)
    }

    @Test fun ignoresOtherWorkspacesAndNonClayverPushes() {
        assertNull(NotificationRouting.destination(push("agent", projectId = "eu"), "default"))
        assertEquals(PushDestination.AgentConversation("-Nx"), NotificationRouting.destination(push("agent", projectId = null), "default"))
        assertEquals(PushDestination.AgentConversation("-Nx"), NotificationRouting.destination(push("agent", projectId = "eu"), null))
        assertNull(NotificationRouting.destination(mapOf("audience" to "agent", "conversationId" to "-Nx"), "default"))
    }

    @Test fun usesASeparateChannelForAgents() {
        assertEquals("clayver_messages", NotificationRouting.channelId(PushAudience.CUSTOMER, "clayver_messages"))
        assertEquals("clayver_agent_messages", NotificationRouting.channelId(PushAudience.AGENT, "clayver_messages"))
        assertEquals("staff", NotificationRouting.channelId(PushAudience.AGENT, "clayver_messages", "staff"))
    }

    @Test fun suppressesOnlyWhenTheMatchingViewShowsTheConversation() {
        val customer = PushDestination.CustomerChat("-Nx")
        val agent = PushDestination.AgentConversation("-Nx")
        assertFalse(NotificationRouting.shouldShow(customer, "-Nx", null, showWhenVisible = false))
        assertTrue(NotificationRouting.shouldShow(customer, null, "-Nx", showWhenVisible = false))
        assertFalse(NotificationRouting.shouldShow(agent, null, "-Nx", showWhenVisible = false))
        assertTrue(NotificationRouting.shouldShow(agent, "-Nx", null, showWhenVisible = false))
        assertTrue(NotificationRouting.shouldShow(agent, null, "-Nx", showWhenVisible = true))
        assertTrue(NotificationRouting.shouldShow(agent, null, "-Other", showWhenVisible = false))
    }

    @Test fun customerAndAgentNotificationsDoNotReplaceEachOther() {
        assertNotEquals(
            NotificationRouting.notificationId(PushDestination.CustomerChat("-Nx")),
            NotificationRouting.notificationId(PushDestination.AgentConversation("-Nx")),
        )
        assertEquals("-Nx".hashCode(), NotificationRouting.notificationId(PushDestination.CustomerChat("-Nx")))
    }
}
