package com.clayver.sdk.internal

import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverTag
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import kotlin.random.Random

class TagRulesTest {
    @Test fun slugFollowsTheSchemaRules() {
        assertEquals("feature-request", TagRules.slugOrNull("Feature request"))
        assertEquals("waiting-on-customer", TagRules.slugOrNull("Waiting on customer"))
        assertEquals("diacritics are stripped, runs collapse, dashes trimmed", "cafe-creme", TagRules.slugOrNull("  Café Crème!! "))
        assertEquals("v2-0-beta", TagRules.slugOrNull("V2.0 -- Beta"))
        assertEquals("compatibility forms decompose (NFKD)", "fullwidth", TagRules.slugOrNull("Ｆｕｌｌｗｉｄｔｈ"))
        assertEquals("letters without a decomposition become separators", "stra-e", TagRules.slugOrNull("Straße"))
        assertEquals("a".repeat(40), TagRules.slugOrNull("a".repeat(50)))
        // Cut after trimming, as specified: the cut can end on a dash (still a valid id).
        assertEquals("x".repeat(39), TagRules.slugOrNull("x".repeat(39) + " yz"))
    }

    @Test fun nameWithoutUsableCharactersGetsARandomId() {
        assertNull(TagRules.slugOrNull("🔥🔥"))
        assertNull(TagRules.slugOrNull(" -- "))
        val id = TagRules.tagId("🔥🔥", Random(42))
        assertTrue(id, Regex("^tag-[a-z0-9]{8}$").matches(id))
        assertTrue(TagRules.isValidId(id))
        assertEquals("billing", TagRules.tagId("Billing"))
    }

    @Test fun defaultColorIsPickedBySlug() {
        assertEquals(10, TagRules.PALETTE.size)
        // "todo": 116 + 111 + 100 + 111 = 438 -> index 8
        assertEquals("#0891B2", TagRules.defaultColor("todo"))
        // "a": 97 -> index 7
        assertEquals("#16A34A", TagRules.defaultColor("a"))
        // "bug": 98 + 117 + 103 = 318 -> index 8
        assertEquals("#0891B2", TagRules.defaultColor("bug"))
        assertEquals("#2563EB", TagRules.defaultColor("dd")) // 200 -> index 0
    }

    @Test fun validatesNamesColorsAndIds() {
        assertEquals("Urgent", TagRules.normalizeName("  Urgent "))
        assertEquals("n".repeat(40), TagRules.normalizeName("n".repeat(40)))
        listOf("", "   ", "n".repeat(41)).forEach { name ->
            try {
                TagRules.normalizeName(name)
                fail("accepted \"$name\"")
            } catch (e: ClayverException) {
                assertEquals(ClayverErrorCode.INVALID_ARGUMENT, e.code)
            }
        }
        assertEquals("#abcdef", TagRules.colorFor("x", "#abcdef"))
        assertEquals(TagRules.defaultColor("todo"), TagRules.colorFor("todo", null))
        try {
            TagRules.colorFor("x", "red")
            fail("accepted a named color")
        } catch (e: ClayverException) {
            assertEquals(ClayverErrorCode.INVALID_ARGUMENT, e.code)
        }
        assertTrue(TagRules.isValidId("in-progress"))
        assertTrue(!TagRules.isValidId("-x") && !TagRules.isValidId("A") && !TagRules.isValidId("a".repeat(41)))
    }

    @Test fun parsesCatalogAndConversationTags() {
        val catalog = TagRules.tags(
            mapOf(
                "urgent" to mapOf("name" to "Urgent", "color" to "#DC2626", "createdAt" to 1L, "createdBy" to "system"),
                "bug" to mapOf("name" to "bug", "color" to "nope"),
                "account" to mapOf("name" to "Account", "color" to "#0891B2"),
                "broken" to mapOf("color" to "#000000"),
                "other" to "not a map",
            ),
        )
        assertEquals(listOf("account", "bug", "urgent"), catalog.map { it.id })
        assertEquals("a malformed color falls back to the default", ClayverTag("bug", "bug", TagRules.defaultColor("bug")), catalog[1])
        assertEquals(listOf("a", "c"), TagRules.conversationTagIds(mapOf("c" to true, "a" to true, "b" to false, "d" to "yes")))
        assertEquals(emptyList<String>(), TagRules.conversationTagIds(null))
    }

    @Test fun tagAndModerationPaths() {
        val p = Paths("default")
        assertEquals("clayver/projects/default/tags/bug", p.tag("bug"))
        assertEquals("clayver/projects/default/conversationTags/-C1/bug", p.conversationTag("-C1", "bug"))
        assertEquals("clayver/projects/default/tagIndex/bug", p.tagIndex("bug"))
        assertEquals("clayver/projects/default/moderation/v_1", p.moderation("v_1"))
    }
}
