package com.clayver.sdk.internal

import com.clayver.sdk.ClayverBlockReason
import com.clayver.sdk.ClayverBlockStatus

/**
 * Pure rules for `moderation/{customerId}`. A block is active when
 * `blocked === true && (until == null || until > now)`.
 */
internal object ModerationRules {

    /** The active block in [value] at [now], or null. */
    fun blockStatus(value: Any?, now: Long): ClayverBlockStatus? {
        val map = value as? Map<*, *> ?: return null
        if (map["blocked"] != true) return null
        val until = ModelParsing.long(map["until"])
        if (until != null && until <= now) return null
        return ClayverBlockStatus(ClayverBlockReason.fromWire(map["reason"]), until)
    }

    /**
     * Milliseconds from [now] until the status of [value] changes on its own
     * (an active block with `until` expiring), or null when it never does.
     */
    fun millisUntilChange(value: Any?, now: Long): Long? {
        val until = blockStatus(value, now)?.until ?: return null
        return until - now
    }
}
