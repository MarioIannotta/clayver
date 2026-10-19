package com.clayver.sdk.internal

import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverTag
import java.text.Normalizer
import kotlin.random.Random

/**
 * Pure rules for the workspace tag catalog (database.schema.md, `tags/{tagId}`):
 * the id is the slug of the name, and a new tag without an explicit color gets
 * the palette color picked by its slug.
 */
internal object TagRules {
    const val MAX_NAME_LENGTH: Int = 40
    const val MAX_ID_LENGTH: Int = 40

    /** Colors offered for new tags, in schema order. */
    val PALETTE: List<String> = listOf(
        "#2563EB", "#7C3AED", "#D97706", "#64748B", "#DC2626",
        "#EA580C", "#0D9488", "#16A34A", "#0891B2", "#DB2777",
    )

    private val ID = Regex("^[a-z0-9][a-z0-9-]{0,39}$")
    private val COLOR = Regex("^#[0-9A-Fa-f]{6}$")
    private val MARKS = Regex("\\p{M}+")
    private val NOT_SLUG = Regex("[^a-z0-9]+")
    private const val RANDOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"

    fun isValidId(id: String): Boolean = ID.matches(id)

    fun isValidColor(color: String): Boolean = COLOR.matches(color)

    /**
     * The slug of [name]: lowercase, NFKD without combining marks, every run
     * outside `[a-z0-9]` replaced by `-`, `-` trimmed, cut to 40 characters.
     * Null when nothing usable is left (e.g. only emoji).
     */
    fun slugOrNull(name: String): String? {
        val decomposed = Normalizer.normalize(name.lowercase(), Normalizer.Form.NFKD).replace(MARKS, "")
        val slug = decomposed.replace(NOT_SLUG, "-").trim('-').take(MAX_ID_LENGTH).trimEnd('-')
        return slug.takeIf(::isValidId)
    }

    /** The id a new tag named [name] gets: its slug, else `tag-` plus 8 random `[a-z0-9]`. */
    fun tagId(name: String, random: Random = Random.Default): String =
        slugOrNull(name) ?: ("tag-" + (1..8).map { RANDOM_ALPHABET[random.nextInt(RANDOM_ALPHABET.length)] }.joinToString(""))

    /** The palette color for [slug]: the sum of its UTF-16 code units modulo 10. */
    fun defaultColor(slug: String): String = PALETTE[slug.sumOf { it.code } % PALETTE.size]

    /** Trims [name] and checks the 1-40 characters rule. */
    fun normalizeName(name: String): String {
        val trimmed = name.trim()
        if (trimmed.isEmpty() || trimmed.length > MAX_NAME_LENGTH) {
            throw ClayverException.invalidArgument("A tag name must be 1-$MAX_NAME_LENGTH characters.")
        }
        return trimmed
    }

    /** [color] when it is `#rrggbb`, else the default for [tagId]. Throws for a malformed explicit color. */
    fun colorFor(tagId: String, color: String?): String {
        if (color == null) return defaultColor(tagId)
        if (!isValidColor(color)) throw ClayverException.invalidArgument("A tag color must be #rrggbb.")
        return color
    }

    /** Parses `tags/{id}`; records without a name are skipped, a bad color falls back to the default. */
    fun tag(id: String, value: Any?): ClayverTag? {
        val map = value as? Map<*, *> ?: return null
        val name = (map["name"] as? String)?.takeIf { it.isNotBlank() } ?: return null
        val color = (map["color"] as? String)?.takeIf(::isValidColor) ?: defaultColor(id)
        return ClayverTag(id, name, color)
    }

    /** Catalog order: by name (case-insensitive), then id. */
    val ORDER: Comparator<ClayverTag> = compareBy<ClayverTag, String>(String.CASE_INSENSITIVE_ORDER) { it.name }.thenBy { it.id }

    /** Parses the `tags` catalog in [ORDER]. */
    fun tags(children: Map<*, *>?): List<ClayverTag> =
        children.orEmpty().entries
            .mapNotNull { (k, v) -> (k as? String)?.let { tag(it, v) } }
            .sortedWith(ORDER)

    /** The tag ids of `conversationTags/{conversationId}` whose value is `true`, sorted. */
    fun conversationTagIds(children: Any?): List<String> =
        (children as? Map<*, *>).orEmpty().entries
            .mapNotNull { (k, v) -> (k as? String)?.takeIf { v == true } }
            .sorted()
}
