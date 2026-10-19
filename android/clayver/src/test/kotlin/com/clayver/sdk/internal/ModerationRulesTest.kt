package com.clayver.sdk.internal

import com.clayver.sdk.ClayverBlockReason
import com.clayver.sdk.ClayverBlockStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ModerationRulesTest {
    private val now = 1_000_000L

    @Test fun activeOnlyWhenBlockedIsTrueAndUntilIsAbsentOrLater() {
        assertEquals(
            ClayverBlockStatus(ClayverBlockReason.ABUSE, null),
            ModerationRules.blockStatus(mapOf("blocked" to true, "reason" to "abuse", "by" to "u1", "at" to 5L), now),
        )
        assertEquals(
            ClayverBlockStatus(ClayverBlockReason.RATE_LIMIT, now + 1),
            ModerationRules.blockStatus(mapOf("blocked" to true, "reason" to "rate_limit", "until" to now + 1), now),
        )
        assertNull("expired", ModerationRules.blockStatus(mapOf("blocked" to true, "reason" to "spam", "until" to now), now))
        assertNull(ModerationRules.blockStatus(mapOf("blocked" to false, "reason" to "spam"), now))
        assertNull(ModerationRules.blockStatus(mapOf("blocked" to "true"), now))
        assertNull(ModerationRules.blockStatus(null, now))
    }

    @Test fun unknownReasonsMapToOther() {
        assertEquals(ClayverBlockReason.OTHER, ModerationRules.blockStatus(mapOf("blocked" to true, "reason" to "fraud"), now)?.reason)
        assertEquals(ClayverBlockReason.OTHER, ModerationRules.blockStatus(mapOf("blocked" to true), now)?.reason)
        assertEquals("rateLimit", ClayverBlockReason.RATE_LIMIT.apiName)
    }

    @Test fun reEvaluatesWhenATimedBlockEnds() {
        val timed = mapOf("blocked" to true, "reason" to "spam", "until" to now + 600_000L)
        assertEquals(600_000L, ModerationRules.millisUntilChange(timed, now))
        assertNull(ModerationRules.millisUntilChange(timed, now + 600_000L))
        assertNull("permanent blocks never change on their own", ModerationRules.millisUntilChange(mapOf("blocked" to true), now))
        assertNull(ModerationRules.millisUntilChange(null, now))
    }
}
