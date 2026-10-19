package com.clayver.sdk.ui

import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverSenderType
import java.text.DateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** A row of the message list, oldest first. */
internal sealed interface ChatRow {
    val key: String

    data class DayHeader(val dayStart: Long, val label: DayLabel) : ChatRow {
        override val key: String get() = "day-$dayStart"
    }

    data object UnreadDivider : ChatRow {
        override val key: String get() = "unread-divider"
    }

    data class Message(
        val item: ChatItem,
        /** Show the sender's name above the bubble (first agent message of a run). */
        val showSender: Boolean,
        val seen: Boolean,
    ) : ChatRow {
        override val key: String get() = item.key
    }
}

internal sealed interface DayLabel {
    data object Today : DayLabel
    data object Yesterday : DayLabel
    data class Date(val text: String) : DayLabel
}

/** Whose side of the conversation the screen shows: the customer chat, or the agent view. */
internal enum class ChatPerspective {
    CUSTOMER,
    AGENT;

    /** True for messages drawn on the right ("mine"): the customer's own, or the team's in the agent view. */
    fun isOwnSide(message: ClayverMessage): Boolean = when (this) {
        CUSTOMER -> message.isFromCustomer
        AGENT -> message.senderType == ClayverSenderType.AGENT
    }
}

internal object ChatFormatting {

    /** Builds the list rows: day headers, the unread divider and messages. */
    fun rows(
        state: ChatUiState,
        now: Long,
        timeZone: TimeZone = TimeZone.getDefault(),
        locale: Locale = Locale.getDefault(),
    ): List<ChatRow> = rows(state.items, state.unreadDividerBeforeId, state.seenMessageId, now, timeZone, locale)

    /**
     * The sender is named above the first message of each agent or system run
     * (per agent, since several teammates may answer), in both perspectives.
     */
    fun rows(
        items: List<ChatItem>,
        unreadDividerBeforeId: String?,
        seenMessageId: String?,
        now: Long,
        timeZone: TimeZone = TimeZone.getDefault(),
        locale: Locale = Locale.getDefault(),
    ): List<ChatRow> {
        val rows = ArrayList<ChatRow>(items.size + 8)
        var lastDay = Long.MIN_VALUE
        var previous: ChatItem? = null
        for (item in items) {
            val day = startOfDay(item.message.createdAt, timeZone)
            if (day != lastDay) {
                rows += ChatRow.DayHeader(day, dayLabel(item.message.createdAt, now, timeZone, locale))
                lastDay = day
                previous = null
            }
            if (item.key == unreadDividerBeforeId) rows += ChatRow.UnreadDivider
            val m = item.message
            val showSender = !m.isFromCustomer &&
                (previous == null || previous.message.senderType != m.senderType || previous.message.senderId != m.senderId)
            rows += ChatRow.Message(item, showSender, seen = item.key == seenMessageId)
            previous = item
        }
        return rows
    }

    fun startOfDay(millis: Long, timeZone: TimeZone): Long = Calendar.getInstance(timeZone).run {
        timeInMillis = millis
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
        timeInMillis
    }

    fun dayLabel(millis: Long, now: Long, timeZone: TimeZone, locale: Locale): DayLabel {
        val day = startOfDay(millis, timeZone)
        val today = startOfDay(now, timeZone)
        val yesterday = Calendar.getInstance(timeZone).run {
            timeInMillis = today
            add(Calendar.DAY_OF_YEAR, -1)
            timeInMillis
        }
        return when (day) {
            today -> DayLabel.Today
            yesterday -> DayLabel.Yesterday
            else -> DayLabel.Date(
                DateFormat.getDateInstance(DateFormat.MEDIUM, locale).apply { this.timeZone = timeZone }.format(Date(millis)),
            )
        }
    }

    fun time(millis: Long, timeZone: TimeZone = TimeZone.getDefault(), locale: Locale = Locale.getDefault()): String =
        DateFormat.getTimeInstance(DateFormat.SHORT, locale).apply { this.timeZone = timeZone }.format(Date(millis))

    fun fileSize(bytes: Long, locale: Locale = Locale.getDefault()): String = when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> String.format(locale, "%.1f KB", bytes / 1024.0)
        else -> String.format(locale, "%.1f MB", bytes / (1024.0 * 1024.0))
    }

    /** Parses `#RRGGBB` / `#AARRGGBB` into an ARGB int, or null. */
    fun parseHexColor(value: String?): Int? {
        val hex = value?.trim()?.removePrefix("#") ?: return null
        if (!hex.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) return null
        return when (hex.length) {
            6 -> (0xFF000000L or hex.toLong(16)).toInt()
            8 -> hex.toLong(16).toInt()
            else -> null
        }
    }
}
