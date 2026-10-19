package com.clayver.sdk.ui

import com.clayver.sdk.ClayverTag
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TagPickerTest {
    private val catalog = listOf(
        ClayverTag("billing", "Billing", "#16A34A"),
        ClayverTag("bug", "Bug", "#EA580C"),
        ClayverTag("cafe", "Café", "#0D9488"),
        ClayverTag("feature-request", "Feature request", "#0D9488"),
    )

    @Test fun filtersByNameOrSlugAndMarksSelection() {
        assertEquals(4, TagPicker.rows(catalog, setOf("bug"), "  ").size)
        val rows = TagPicker.rows(catalog, setOf("bug"), "BU")
        assertEquals(listOf("bug"), rows.map { it.tag.id })
        assertEquals(true, rows.single().selected)
        assertEquals("accents don't matter through the slug", listOf("cafe"), TagPicker.rows(catalog, emptySet(), "cafe").map { it.tag.id })
        assertEquals(listOf("feature-request"), TagPicker.rows(catalog, emptySet(), "feature-req").map { it.tag.id })
    }

    @Test fun offersToCreateOnlyWithoutAnExactMatch() {
        assertEquals("Bugs", TagPicker.createCandidate(catalog, " Bugs "))
        assertNull("same name ignoring case", TagPicker.createCandidate(catalog, "bug"))
        assertNull("same slug", TagPicker.createCandidate(catalog, "Feature  Request!"))
        assertNull(TagPicker.createCandidate(catalog, "   "))
        assertNull("too long to be a name", TagPicker.createCandidate(catalog, "n".repeat(41)))
        assertEquals("🔥", TagPicker.createCandidate(catalog, "🔥"))
    }

    @Test fun selectedTagsFollowCatalogOrder() {
        assertEquals(listOf("billing", "bug"), TagPicker.selected(catalog, listOf("bug", "unknown", "billing")).map { it.id })
    }
}
