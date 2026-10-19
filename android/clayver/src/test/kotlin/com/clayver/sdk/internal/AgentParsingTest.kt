package com.clayver.sdk.internal

import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.ClayverSenderType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentParsingTest {
    @Test fun parsesConversationRecordsForAgents() {
        val c = ModelParsing.agentConversation(
            "-C1",
            mapOf(
                "customerId" to "v_abc",
                "status" to "closed",
                "createdAt" to 10L,
                "updatedAt" to 20.0,
                "assigneeUid" to "agent1",
                "unread" to mapOf("customer" to 4L, "agent" to 2L),
                "statusOrder" to "closed_000000000000020",
                "lastMessage" to mapOf("text" to "hi", "senderType" to "customer", "createdAt" to 20L, "hasAttachment" to false),
            ),
        )!!
        assertEquals("v_abc", c.customerId)
        assertEquals(ClayverConversationStatus.CLOSED, c.status)
        assertEquals(20L, c.updatedAt)
        assertEquals(2, c.unreadForAgents)
        assertEquals("agent1", c.assigneeUid)
        assertEquals(ClayverSenderType.CUSTOMER, c.lastMessage?.senderType)
    }

    @Test fun skipsRecordsWithoutCustomerAndDefaultsTheRest() {
        assertNull(ModelParsing.agentConversation("-C1", mapOf("status" to "open")))
        assertNull(ModelParsing.agentConversation("-C1", "garbage"))
        val c = ModelParsing.agentConversation("-C2", mapOf("customerId" to "u1", "createdAt" to 5L, "assigneeUid" to ""))!!
        assertEquals(ClayverConversationStatus.OPEN, c.status)
        assertEquals(5L, c.updatedAt)
        assertEquals(0, c.unreadForAgents)
        assertNull(c.assigneeUid)
        assertEquals(0, ModelParsing.unreadForAgents(mapOf("agent" to -3L)))
    }

    @Test fun listsNewestFirst() {
        val list = ModelParsing.agentConversations(
            mapOf(
                "-C1" to mapOf("customerId" to "a", "updatedAt" to 10L),
                "-C2" to mapOf("customerId" to "b", "updatedAt" to 30L),
                "-C3" to mapOf("customerId" to "c", "updatedAt" to 30L),
                "-C4" to mapOf("updatedAt" to 99L),
            ),
        )
        assertEquals(listOf("-C3", "-C2", "-C1"), list.map { it.id })
    }

    @Test fun parsesCustomerProfiles() {
        val p = ModelParsing.customerProfile(
            "uid_abc",
            mapOf(
                "account" to mapOf("anonymous" to false, "email" to "ada@example.com", "emailVerified" to true),
                "lastSeenAt" to 42L,
                "properties" to mapOf("_name" to "Ada", "_email" to "ada@x.io", "_uid" to "u-42", "plan" to "pro", "seats" to 3L, "ratio" to 0.5, "vip" to true, "bad" to listOf(1)),
            ),
        )
        assertEquals(com.clayver.sdk.ClayverCustomerAccount(false, "ada@example.com", true, null), p.account)
        assertEquals(42L, p.lastSeenAt)
        assertEquals("Ada", p.name)
        assertEquals("ada@x.io", p.email)
        assertEquals("u-42", p.userId)
        assertEquals(setOf("plan", "seats", "ratio", "vip"), p.customProperties.keys)
        assertEquals(setOf("_name", "_email", "_uid", "plan", "seats", "ratio", "vip"), p.properties.keys)
        val empty = ModelParsing.customerProfile("u1", null)
        assertTrue(empty.properties.isEmpty())
        assertNull(empty.name)
        assertNull(empty.account)
        assertNull(ModelParsing.customerProfile("u1", mapOf("account" to mapOf("email" to "x@y.z"))).account)
    }
}
