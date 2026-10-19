package com.clayver.sdk.internal

import com.clayver.sdk.ClayverAgentRole
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverTriage
import com.clayver.sdk.ClayverTriageOption
import com.clayver.sdk.ClayverTriageOptions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TriageRulesTest {

    @Test fun missingListsUseTheDefaults() {
        val options = TriageRules.options(null)
        assertEquals(listOf("high", "medium", "low"), options.priority.map { it.id })
        assertEquals(listOf("todo", "in_progress", "on_hold"), options.stage.map { it.id })
        assertEquals("#DC2626", options.priority.first().color)
        assertEquals("In progress", options.stage[1].name)
        assertEquals(ClayverTriageOptions(), TriageRules.options(mapOf("priority" to "junk")))
    }

    @Test fun savedListsAreSortedByOrderAndMalformedEntriesSkipped() {
        val options = TriageRules.options(
            mapOf(
                "priority" to mapOf(
                    "urgent" to mapOf("name" to "Urgent", "color" to "#FF0000", "order" to 1L),
                    "p0" to mapOf("name" to "P0", "color" to "nope", "order" to 0L),
                    "Bad Id" to mapOf("name" to "Bad", "color" to "#000000", "order" to 2L),
                    "noname" to mapOf("color" to "#000000", "order" to 3L),
                ),
            ),
        )
        assertEquals(
            listOf(ClayverTriageOption("p0", "P0", "#64748B", 0), ClayverTriageOption("urgent", "Urgent", "#FF0000", 1)),
            options.priority,
        )
        assertEquals("the stage list was never saved", ClayverTriageOptions.DEFAULT_STAGE, options.stage)
    }

    @Test fun parsesTriageAndResolvesOnlyListedValues() {
        assertEquals(ClayverTriage(), TriageRules.triage(null))
        val triage = TriageRules.triage(mapOf("priority" to "high", "stage" to "removed"))
        assertEquals(ClayverTriage("high", "removed"), triage)
        assertEquals("High", TriageRules.resolve(ClayverTriageOptions.DEFAULT_PRIORITY, triage.priority)?.name)
        assertNull(TriageRules.resolve(ClayverTriageOptions.DEFAULT_STAGE, triage.stage))
        assertNull(TriageRules.resolve(ClayverTriageOptions.DEFAULT_STAGE, null))
    }

    @Test fun optionIds() {
        assertTrue(TriageRules.isValidOptionId("in_progress"))
        assertTrue(TriageRules.isValidOptionId("p0"))
        assertFalse(TriageRules.isValidOptionId("_x"))
        assertFalse(TriageRules.isValidOptionId("High"))
        assertFalse(TriageRules.isValidOptionId("a".repeat(41)))
    }

    @Test fun notesAreNewestFirstAndValidated() {
        val notes = TriageRules.notes(
            "-C1",
            mapOf(
                "-N1" to mapOf("authorUid" to "a", "text" to "first", "createdAt" to 10L),
                "-N2" to mapOf("authorUid" to "b", "authorName" to "Bo", "text" to "second", "createdAt" to 20L),
                "-N3" to mapOf("text" to "no author", "createdAt" to 30L),
            ),
        )
        assertEquals(listOf("-N2", "-N1"), notes.map { it.id })
        assertEquals("Bo", notes[0].authorName)
        assertNull(notes[1].authorName)

        assertEquals("hi", TriageRules.normalizeNote("  hi \n"))
        assertThrows { TriageRules.normalizeNote("   ") }
        assertThrows { TriageRules.normalizeNote("x".repeat(4001)) }
        assertEquals("x".repeat(80), TriageRules.authorName("x".repeat(100)))
        assertNull(TriageRules.authorName("  "))
    }

    @Test fun teamIsSortedByName() {
        val team = TriageRules.team(
            mapOf(
                "u2" to mapOf("displayName" to "zoe", "role" to "admin", "active" to true),
                "u1" to mapOf("email" to "amy@example.com", "role" to "agent", "active" to false),
                "u3" to "junk",
            ),
        )
        assertEquals(listOf("u1", "u2"), team.map { it.uid })
        assertEquals(ClayverAgentRole.ADMIN, team[1].role)
        assertFalse(team[0].active)
    }

    private fun assertThrows(block: () -> Unit) {
        try {
            block()
        } catch (_: ClayverException) {
            return
        }
        throw AssertionError("expected a ClayverException")
    }
}
