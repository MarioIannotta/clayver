package com.clayver.sdk.internal

import com.clayver.sdk.ClayverAgentRole
import com.clayver.sdk.ClayverConversationStatus

/** Name of the custom claim that mirrors `agents/{uid}/role` per workspace. */
internal const val CLAIM_ROLES: String = "clayver_roles"

/**
 * Pure rules for agent mode (database.schema.md, "Agents inside the mobile app").
 * The database rules stay the authority; these only decide what the SDK shows
 * and fail fast before a request that would be denied anyway.
 */
internal object AgentRules {
    const val MAX_SENDER_NAME_LENGTH: Int = 80

    /** `clayver_roles[projectId]` from verified ID token claims, or null without a role. */
    fun roleFromClaims(claims: Map<String, Any?>?, projectId: String): ClayverAgentRole? {
        val roles = claims?.get(CLAIM_ROLES) as? Map<*, *> ?: return null
        return ClayverAgentRole.fromWire(roles[projectId])
    }

    /** `startAt` of the inbox query: `orderByChild('statusOrder').startAt('{status}_')`. */
    fun statusOrderStart(status: ClayverConversationStatus): String = "${status.wireValue}_"

    /** `endAt` of the inbox query: `'{status}_~'` (`~` sorts after the zero-padded digits). */
    fun statusOrderEnd(status: ClayverConversationStatus): String = "${status.wireValue}_~"

    /**
     * The `senderName` written on agent replies: `agents/{uid}/displayName`,
     * then the Firebase profile name, then the local part of the e-mail.
     * Null (field omitted) when none is usable. Capped at 80 characters.
     */
    fun senderName(agentDisplayName: String?, authDisplayName: String?, email: String?): String? {
        val candidate = agentDisplayName?.trim()?.takeIf { it.isNotEmpty() }
            ?: authDisplayName?.trim()?.takeIf { it.isNotEmpty() }
            ?: email?.substringBefore('@')?.trim()?.takeIf { it.isNotEmpty() }
            ?: return null
        return candidate.take(MAX_SENDER_NAME_LENGTH)
    }

    /**
     * A short, stable label for a customer without a name: the first 6
     * characters of the id.
     */
    fun shortCustomerId(customerId: String): String = customerId.take(6)
}
