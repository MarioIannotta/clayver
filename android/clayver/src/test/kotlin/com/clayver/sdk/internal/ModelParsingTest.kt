package com.clayver.sdk.internal

import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.ClayverSenderType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ModelParsingTest {
    @Test fun parsesMessagesInKeyOrderAndSkipsMalformed() {
        val raw = mapOf(
            "-N2" to mapOf("senderId" to "agent1", "senderType" to "agent", "senderName" to "Ann", "text" to "Hi", "createdAt" to 2L),
            "-N1" to mapOf("senderId" to "cid", "senderType" to "customer", "text" to "Hello", "createdAt" to 1L, "clientMessageId" to "a_x"),
            "-N3" to mapOf("senderType" to "customer"),
            "-N4" to mapOf("senderType" to "robot", "text" to "?"),
            "-N5" to mapOf("senderType" to "customer", "createdAt" to 5.0,
                "attachment" to mapOf("storagePath" to "p/x.png", "fileName" to "x.png", "contentType" to "image/png", "size" to 10L, "width" to 4L, "height" to 3L)),
        )
        val list = ModelParsing.messages("-C", raw)
        assertEquals(listOf("-N1", "-N2", "-N5"), list.map { it.id })
        assertEquals(ClayverSenderType.AGENT, list[1].senderType)
        assertEquals("Ann", list[1].senderName)
        assertEquals("a_x", list[0].clientMessageId)
        assertEquals(5L, list[2].createdAt)
        assertEquals(4, list[2].attachment!!.width)
        assertEquals(true, list[2].attachment!!.isImage)
    }

    @Test fun parsesInboxConversations() {
        val raw = mapOf(
            "-A" to mapOf("status" to "closed", "createdAt" to 1L, "updatedAt" to 10L, "unread" to mapOf("customer" to 2L, "agent" to 0L)),
            "-B" to mapOf("status" to "open", "createdAt" to 5L, "updatedAt" to 20L, "unread" to 1L,
                "lastMessage" to mapOf("text" to "yo", "senderType" to "agent", "createdAt" to 20L, "hasAttachment" to false)),
        )
        val list = ModelParsing.conversations(raw)
        assertEquals(listOf("-B", "-A"), list.map { it.id })
        assertEquals(1, list[0].unreadCount)
        assertEquals(2, list[1].unreadCount)
        assertEquals(ClayverConversationStatus.CLOSED, list[1].status)
        assertEquals("yo", list[0].lastMessage!!.text)
        assertNull(list[1].lastMessage)
    }

    @Test fun parsesConfigAndReadMarkers() {
        assertEquals("Acme", ModelParsing.publicConfig(mapOf("teamName" to "Acme", "welcomeMessage" to "")).teamName)
        assertNull(ModelParsing.publicConfig(mapOf("welcomeMessage" to "")).welcomeMessage)
        assertEquals(42L, ModelParsing.lastReadAt(mapOf("lastReadAt" to 42L, "uid" to "u")))
        assertNull(ModelParsing.lastReadAt(null))
    }
}
