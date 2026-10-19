package com.clayver.sdk.ui

import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverSenderType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale
import java.util.TimeZone

class ChatFormattingTest {
    private val utc = TimeZone.getTimeZone("UTC")
    private val day = 86_400_000L
    private val now = 20_000 * day + 12 * 3_600_000L

    private fun item(id: String, type: ClayverSenderType, at: Long, sender: String = type.wireValue) = ChatItem(
        id,
        ClayverMessage(id = id, conversationId = "c", senderId = sender, senderType = type, text = id, createdAt = at),
        DeliveryState.SENT,
    )

    @Test fun buildsDayHeadersDividerSenderRunsAndSeen() {
        val state = ChatUiState(
            phase = ChatPhase.Ready,
            items = listOf(
                item("-1", ClayverSenderType.CUSTOMER, now - 2 * day),
                item("-2", ClayverSenderType.AGENT, now - day, "ann"),
                item("-3", ClayverSenderType.AGENT, now - day + 1, "ann"),
                item("-4", ClayverSenderType.AGENT, now - day + 2, "bob"),
                item("-5", ClayverSenderType.CUSTOMER, now),
            ),
            unreadDividerBeforeId = "-3",
            seenMessageId = "-5",
        )
        val rows = ChatFormatting.rows(state, now, utc, Locale.US)
        assertEquals(
            listOf("day-${19_998 * day}", "-1", "day-${19_999 * day}", "-2", "unread-divider", "-3", "-4", "day-${20_000 * day}", "-5"),
            rows.map { it.key },
        )
        val messages = rows.filterIsInstance<ChatRow.Message>().associateBy { it.key }
        assertTrue(messages.getValue("-2").showSender)
        assertEquals(false, messages.getValue("-3").showSender)
        assertTrue(messages.getValue("-4").showSender)
        assertEquals(false, messages.getValue("-1").showSender)
        assertTrue(messages.getValue("-5").seen)
        assertEquals(DayLabel.Today, (rows[7] as ChatRow.DayHeader).label)
        assertEquals(DayLabel.Yesterday, (rows[2] as ChatRow.DayHeader).label)
        assertTrue((rows[0] as ChatRow.DayHeader).label is DayLabel.Date)
    }

    @Test fun formatsSizesAndColors() {
        assertEquals("512 B", ChatFormatting.fileSize(512, Locale.US))
        assertEquals("1.5 KB", ChatFormatting.fileSize(1536, Locale.US))
        assertEquals("2.0 MB", ChatFormatting.fileSize(2L * 1024 * 1024, Locale.US))
        assertEquals(0xFF3366CC.toInt(), ChatFormatting.parseHexColor("#3366cc"))
        assertEquals(0x803366CC.toInt(), ChatFormatting.parseHexColor("803366CC"))
        assertNull(ChatFormatting.parseHexColor("blue"))
        assertNull(ChatFormatting.parseHexColor("#123"))
    }
}
