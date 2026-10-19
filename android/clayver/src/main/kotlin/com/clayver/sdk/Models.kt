package com.clayver.sdk

/** Who wrote a message. */
public enum class ClayverSenderType(public val wireValue: String) {
    CUSTOMER("customer"),
    AGENT("agent"),
    SYSTEM("system");

    public companion object {
        public fun fromWire(value: Any?): ClayverSenderType? = entries.firstOrNull { it.wireValue == value }
    }
}

public enum class ClayverConversationStatus(public val wireValue: String) {
    OPEN("open"),
    CLOSED("closed");

    public companion object {
        public fun fromWire(value: Any?): ClayverConversationStatus =
            entries.firstOrNull { it.wireValue == value } ?: OPEN
    }
}

/** An attachment stored in Cloud Storage. Use its [storagePath] to fetch it. */
public data class ClayverAttachment(
    val storagePath: String,
    val fileName: String,
    val contentType: String,
    val size: Long,
    val width: Int? = null,
    val height: Int? = null,
) {
    val isImage: Boolean get() = contentType.startsWith("image/")
}

public data class ClayverMessage(
    val id: String,
    val conversationId: String,
    val senderId: String,
    val senderType: ClayverSenderType,
    val senderName: String? = null,
    val text: String? = null,
    val attachment: ClayverAttachment? = null,
    /** Server time in milliseconds. While a local write is pending this is the SDK's estimate. */
    val createdAt: Long,
    val clientMessageId: String? = null,
) {
    /** True for messages written by the customer (from any of their devices). */
    val isFromCustomer: Boolean get() = senderType == ClayverSenderType.CUSTOMER
}

public data class ClayverLastMessage(
    val text: String?,
    val senderType: ClayverSenderType?,
    val createdAt: Long,
    val hasAttachment: Boolean,
)

public data class ClayverConversation(
    val id: String,
    val status: ClayverConversationStatus,
    val createdAt: Long,
    val updatedAt: Long,
    val lastMessage: ClayverLastMessage?,
    /** Agent/system messages the customer has not read yet. */
    val unreadCount: Int,
)

/** Workspace configuration readable by any signed-in user (`config/public`). */
public data class ClayverPublicConfig(
    val teamName: String? = null,
    val welcomeMessage: String? = null,
    val accentColor: String? = null,
)

/** Why a customer is blocked (`moderation/{customerId}/reason`). [apiName] is the cross-platform name. */
public enum class ClayverBlockReason(public val wireValue: String, public val apiName: String) {
    SPAM("spam", "spam"),
    ABUSE("abuse", "abuse"),
    RATE_LIMIT("rate_limit", "rateLimit"),
    OTHER("other", "other");

    public companion object {
        /** Unknown values map to [OTHER]. */
        public fun fromWire(value: Any?): ClayverBlockReason = entries.firstOrNull { it.wireValue == value } ?: OTHER
    }
}

/**
 * An active block on the current customer: new conversations and messages are
 * rejected until [until] (server time in milliseconds), or until an agent
 * removes the block when [until] is null.
 */
public data class ClayverBlockStatus(
    val reason: ClayverBlockReason,
    val until: Long? = null,
)

// region agent mode

/** A support role in the workspace, read from the verified ID token claim `clayver_roles[projectId]`. */
public enum class ClayverAgentRole(public val wireValue: String) {
    ADMIN("admin"),
    AGENT("agent");

    public companion object {
        public fun fromWire(value: Any?): ClayverAgentRole? = entries.firstOrNull { it.wireValue == value }
    }
}

/** A conversation as agents see it (`conversations/{id}`). */
public data class ClayverAgentConversation(
    val id: String,
    val customerId: String,
    val status: ClayverConversationStatus,
    val createdAt: Long,
    val updatedAt: Long,
    val lastMessage: ClayverLastMessage?,
    /** Customer messages no agent has read yet (`unread.agent`). */
    val unreadForAgents: Int,
    /** Firebase uid of the agent the conversation is assigned to, if any. */
    val assigneeUid: String?,
)

/**
 * The customer's Firebase Auth account (`users/{customerId}/account`), written by the
 * functions when the customer starts a conversation. The customer id is the Firebase uid.
 */
public data class ClayverCustomerAccount(
    /** True for an anonymous visitor (no sign-in provider). */
    val anonymous: Boolean,
    val email: String?,
    val emailVerified: Boolean,
    val displayName: String?,
)

/** A customer record (`users/{customerId}`), readable by agents. */
public data class ClayverCustomerProfile(
    val customerId: String,
    /** The customer's Firebase Auth account, once a conversation recorded it. */
    val account: ClayverCustomerAccount?,
    /** Values set with `setUserProperties`: String, Long/Double or Boolean. */
    val properties: Map<String, Any>,
    val lastSeenAt: Long?,
) {
    /** The [Clayver.UserProperty.NAME] property, when set. */
    val name: String? get() = (properties[Clayver.UserProperty.NAME] as? String)?.takeIf { it.isNotBlank() }

    /** The [Clayver.UserProperty.EMAIL] property, else the account's email. */
    val email: String?
        get() = (properties[Clayver.UserProperty.EMAIL] as? String)?.takeIf { it.isNotBlank() } ?: account?.email

    /** The [Clayver.UserProperty.UID] property: the host app's own id for the user. */
    val userId: String? get() = (properties[Clayver.UserProperty.UID] as? String)?.takeIf { it.isNotBlank() }

    /** Properties other than the [Clayver.UserProperty] keys. */
    val customProperties: Map<String, Any> get() = properties.filterKeys { it !in Clayver.UserProperty.ALL }
}

/** A tag of the workspace catalog (`tags/{id}`). The id is the slug of the name at creation. */
public data class ClayverTag(
    val id: String,
    val name: String,
    /** `#rrggbb`. */
    val color: String,
)

/** A member of the support team (`agents/{uid}`), readable by agents. */
public data class ClayverTeammate(
    val uid: String,
    val displayName: String?,
    val email: String?,
    val role: ClayverAgentRole?,
    /** False for a teammate whose role was revoked. */
    val active: Boolean,
)

/**
 * One entry of a workspace triage list (`triageOptions/{priority|stage}/{id}`):
 * a conversation priority, or a status (stored as "stage").
 */
public data class ClayverTriageOption(
    val id: String,
    val name: String,
    /** `#rrggbb`. */
    val color: String,
    val order: Int,
)

/**
 * The workspace's priority and status lists. A list that was never saved in
 * the dashboard uses [DEFAULT_PRIORITY] / [DEFAULT_STAGE].
 */
public data class ClayverTriageOptions(
    val priority: List<ClayverTriageOption> = DEFAULT_PRIORITY,
    /** Shown to agents as "Status". */
    val stage: List<ClayverTriageOption> = DEFAULT_STAGE,
) {
    public companion object {
        public val DEFAULT_PRIORITY: List<ClayverTriageOption> = listOf(
            ClayverTriageOption("high", "High", "#DC2626", 0),
            ClayverTriageOption("medium", "Medium", "#D97706", 1),
            ClayverTriageOption("low", "Low", "#64748B", 2),
        )
        public val DEFAULT_STAGE: List<ClayverTriageOption> = listOf(
            ClayverTriageOption("todo", "To do", "#2563EB", 0),
            ClayverTriageOption("in_progress", "In progress", "#7C3AED", 1),
            ClayverTriageOption("on_hold", "On hold", "#64748B", 2),
        )
    }
}

/**
 * A conversation's priority and status (`triage/{conversationId}`), as stored
 * option ids. An id missing from the workspace list shows as unset.
 */
public data class ClayverTriage(
    val priority: String? = null,
    /** Shown to agents as "Status". */
    val stage: String? = null,
)

/** An internal note on a conversation (`notes/{conversationId}/{noteId}`); never shown to the customer. */
public data class ClayverNote(
    val id: String,
    val conversationId: String,
    val authorUid: String,
    val authorName: String?,
    val text: String,
    /** Server time in milliseconds. */
    val createdAt: Long,
)

// endregion
