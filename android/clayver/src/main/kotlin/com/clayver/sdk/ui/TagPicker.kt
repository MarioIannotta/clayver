package com.clayver.sdk.ui

import com.clayver.sdk.ClayverTag
import com.clayver.sdk.internal.TagRules

internal data class TagPickerRow(val tag: ClayverTag, val selected: Boolean)

/** Pure logic of the agent "Add tag" sheet: filtering the catalog and offering to create a tag. */
internal object TagPicker {

    /** Catalog tags whose name contains [query] (ignoring case), or whose id contains its slug (so accents don't matter). */
    fun rows(catalog: List<ClayverTag>, selectedIds: Collection<String>, query: String): List<TagPickerRow> {
        val q = query.trim()
        val slug = TagRules.slugOrNull(q)
        return catalog
            .filter { q.isEmpty() || it.name.contains(q, ignoreCase = true) || (slug != null && it.id.contains(slug)) }
            .map { TagPickerRow(it, it.id in selectedIds) }
    }

    /**
     * The name to offer in "Create tag “…”": the trimmed [query] when it is a
     * valid name and no tag matches it exactly (same name ignoring case, or
     * the id it would get). Null otherwise.
     */
    fun createCandidate(catalog: List<ClayverTag>, query: String): String? {
        val q = query.trim()
        if (q.isEmpty() || q.length > TagRules.MAX_NAME_LENGTH) return null
        val slug = TagRules.slugOrNull(q)
        if (catalog.any { it.name.trim().equals(q, ignoreCase = true) || (slug != null && it.id == slug) }) return null
        return q
    }

    /** The conversation's tags in catalog order; ids missing from the catalog are left out. */
    fun selected(catalog: List<ClayverTag>, ids: Collection<String>): List<ClayverTag> {
        val set = ids.toSet()
        return catalog.filter { it.id in set }
    }
}
