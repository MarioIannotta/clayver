package com.clayver.sdk.internal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationPayloadTest {
    private val full = mapOf(
        "clayver" to "1",
        "type" to "message",
        "projectId" to "default",
        "conversationId" to "-NxConv",
        "messageId" to "-NyMsg",
        "link" to "clayver://conversation/-NxConv",
    )

    @Test fun parsesFullPayload() {
        val p = NotificationPayload.parse(full)!!
        assertEquals("message", p.type)
        assertEquals("default", p.projectId)
        assertEquals("-NxConv", p.conversationId)
        assertEquals("-NyMsg", p.messageId)
        assertEquals("clayver://conversation/-NxConv", p.link)
    }

    @Test fun recognisesOnlyClayverPushes() {
        assertTrue(NotificationPayload.isClayver(full))
        assertFalse(NotificationPayload.isClayver(mapOf("conversationId" to "-Nx")))
        assertFalse(NotificationPayload.isClayver(full + ("clayver" to "0")))
        assertFalse(NotificationPayload.isClayver(null))
        assertNull(NotificationPayload.parse(mapOf("foo" to "bar")))
    }

    @Test fun fallsBackToLink() {
        val p = NotificationPayload.parse(mapOf("clayver" to "1", "link" to "clayver://conversation/-Nabc?x=1"))!!
        assertEquals("-Nabc", p.conversationId)
        assertEquals("message", p.type)
        assertNull(p.projectId)
    }

    @Test fun rejectsMissingOrUnsafeConversation() {
        assertNull(NotificationPayload.parse(mapOf("clayver" to "1", "type" to "message")))
        assertNull(NotificationPayload.parse(mapOf("clayver" to "1", "conversationId" to "a/b")))
        assertNull(NotificationPayload.parse(mapOf("clayver" to "1", "link" to "https://evil/conversation/x")))
        assertNull(NotificationPayload.conversationIdFromLink("clayver://conversation/"))
        assertNull(NotificationPayload.conversationIdFromLink("clayver://conversation/../x"))
    }

    @Test fun acceptsNonStringValuesFromBundles() {
        val p = NotificationPayload.parse(mapOf<String, Any?>("clayver" to 1, "conversationId" to "-Nx"))
        assertEquals("-Nx", p?.conversationId)
    }

    @Test fun buildsLinks() {
        assertEquals("clayver://conversation/-Nx", NotificationPayload.linkFor("-Nx"))
        assertEquals("-Nx", NotificationPayload.conversationIdFromLink(NotificationPayload.linkFor("-Nx")))
    }
}
