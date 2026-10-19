package com.clayver.sdk.internal

import com.clayver.sdk.ClayverAgentRole
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverNote
import com.clayver.sdk.ClayverTeammate
import com.clayver.sdk.ClayverTriage
import com.clayver.sdk.ClayverTriageOption
import com.clayver.sdk.ClayverTriageOptions

/**
 * Pure rules for `triage/`, `triageOptions/`, `notes/` and `agents/`
 * (firebase/database.schema.md).
 */
internal object TriageRules {
    const val PRIORITY = "priority"
    const val STAGE = "stage"
    const val MAX_NOTE_LENGTH = 4000
    const val MAX_AUTHOR_NAME_LENGTH = 80

    private val OPTION_ID = Regex("^[a-z0-9][a-z0-9_-]{0,39}$")
    private val HEX = Regex("^#[0-9a-fA-F]{6}$")
    private const val FALLBACK_COLOR = "#64748B"

    fun isValidOptionId(id: String): Boolean = OPTION_ID.matches(id)

    /** Parses `triageOptions`; a list that does not exist gets its defaults. */
    fun options(value: Any?): ClayverTriageOptions {
        val map = value as? Map<*, *>
        return ClayverTriageOptions(
            priority = optionList(map?.get(PRIORITY)) ?: ClayverTriageOptions.DEFAULT_PRIORITY,
            stage = optionList(map?.get(STAGE)) ?: ClayverTriageOptions.DEFAULT_STAGE,
        )
    }

    /** One list in order (then name, then id); null when the list node does not exist. */
    fun optionList(value: Any?): List<ClayverTriageOption>? {
        val map = value as? Map<*, *> ?: return null
        if (map.isEmpty()) return null
        return map.entries.mapNotNull { (k, v) ->
            val id = (k as? String)?.takeIf(::isValidOptionId) ?: return@mapNotNull null
            val record = v as? Map<*, *> ?: return@mapNotNull null
            val name = (record["name"] as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
            val color = (record["color"] as? String)?.takeIf { HEX.matches(it) } ?: FALLBACK_COLOR
            val order = ModelParsing.long(record["order"])?.toInt() ?: 0
            ClayverTriageOption(id, name, color, order)
        }.sortedWith(
            compareBy<ClayverTriageOption> { it.order }
                .thenBy(String.CASE_INSENSITIVE_ORDER) { it.name }
                .thenBy { it.id },
        )
    }

    /** Parses `triage/{conversationId}`. */
    fun triage(value: Any?): ClayverTriage {
        val map = value as? Map<*, *> ?: return ClayverTriage()
        return ClayverTriage(
            priority = (map[PRIORITY] as? String)?.takeIf { it.isNotEmpty() },
            stage = (map[STAGE] as? String)?.takeIf { it.isNotEmpty() },
        )
    }

    /** The option [id] names in [options]; null for no value or a value not in the list. */
    fun resolve(options: List<ClayverTriageOption>, id: String?): ClayverTriageOption? =
        id?.let { wanted -> options.firstOrNull { it.id == wanted } }

    /** Trimmed note text; throws INVALID_ARGUMENT when empty or longer than 4000 characters. */
    fun normalizeNote(text: String): String {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) throw ClayverException.invalidArgument("A note needs text.")
        if (trimmed.length > MAX_NOTE_LENGTH) {
            throw ClayverException.invalidArgument("A note is at most $MAX_NOTE_LENGTH characters.")
        }
        return trimmed
    }

    /** The `authorName` stored on a note: 1..80 characters, else omitted. */
    fun authorName(name: String?): String? = name?.trim()?.take(MAX_AUTHOR_NAME_LENGTH)?.takeIf { it.isNotEmpty() }

    /** Parses one `notes/{conversationId}/{noteId}` record; malformed ones are null. */
    fun note(conversationId: String, id: String, value: Any?): ClayverNote? {
        val map = value as? Map<*, *> ?: return null
        val author = (map["authorUid"] as? String)?.takeIf { it.isNotEmpty() } ?: return null
        val text = (map["text"] as? String)?.takeIf { it.isNotEmpty() } ?: return null
        return ClayverNote(
            id = id,
            conversationId = conversationId,
            authorUid = author,
            authorName = (map["authorName"] as? String)?.takeIf { it.isNotBlank() },
            text = text,
            createdAt = ModelParsing.long(map["createdAt"]) ?: 0L,
        )
    }

    /** `notes/{conversationId}`, newest first. */
    fun notes(conversationId: String, value: Any?): List<ClayverNote> =
        (value as? Map<*, *>).orEmpty().entries
            .mapNotNull { (k, v) -> (k as? String)?.let { note(conversationId, it, v) } }
            .sortedWith(compareByDescending<ClayverNote> { it.createdAt }.thenByDescending { it.id })

    /** Parses `agents`, sorted by name (then email, then uid). */
    fun team(value: Any?): List<ClayverTeammate> =
        (value as? Map<*, *>).orEmpty().entries.mapNotNull { (k, v) ->
            val uid = k as? String ?: return@mapNotNull null
            val map = v as? Map<*, *> ?: return@mapNotNull null
            ClayverTeammate(
                uid = uid,
                displayName = (map["displayName"] as? String)?.trim()?.takeIf { it.isNotEmpty() },
                email = (map["email"] as? String)?.trim()?.takeIf { it.isNotEmpty() },
                role = ClayverAgentRole.fromWire(map["role"]),
                active = map["active"] == true,
            )
        }.sortedWith(
            compareBy<ClayverTeammate, String>(String.CASE_INSENSITIVE_ORDER) { it.displayName ?: it.email ?: "￿" }
                .thenBy { it.uid },
        )
}
