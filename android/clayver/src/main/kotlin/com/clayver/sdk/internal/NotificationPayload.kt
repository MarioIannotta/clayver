package com.clayver.sdk.internal

/** Who a push is for (`audience`). Absent or unknown values mean the customer, as before agent mode. */
internal enum class PushAudience(val wireValue: String) {
    CUSTOMER("customer"),
    AGENT("agent");

    companion object {
        fun fromWire(value: Any?): PushAudience = if (value?.toString() == AGENT.wireValue) AGENT else CUSTOMER
    }
}

/** The `data` block of a Clayver push (database.schema.md, "Push notification payload"). */
internal data class ClayverPushPayload(
    val type: String,
    val projectId: String?,
    val conversationId: String,
    val messageId: String?,
    val link: String?,
    val audience: PushAudience = PushAudience.CUSTOMER,
)

/** Where a Clayver push leads. */
internal sealed interface PushDestination {
    val conversationId: String

    /** The customer chat ([com.clayver.sdk.ClayverChatActivity]). */
    data class CustomerChat(override val conversationId: String) : PushDestination

    /** The agent conversation view (the support UI in agent mode, [com.clayver.sdk.ClayverChatActivity]). */
    data class AgentConversation(override val conversationId: String) : PushDestination
}

/** Pure routing and display decisions for Clayver pushes. */
internal object NotificationRouting {
    const val AGENT_CHANNEL_ID: String = "clayver_agent_messages"

    /**
     * The screen a push opens, or null when it is not a Clayver push or belongs
     * to another workspace than [configuredProjectId] (null = not configured yet).
     */
    fun destination(data: Map<String, Any?>?, configuredProjectId: String?): PushDestination? {
        val payload = NotificationPayload.parse(data) ?: return null
        return destination(payload, configuredProjectId)
    }

    fun destination(payload: ClayverPushPayload, configuredProjectId: String?): PushDestination? {
        if (configuredProjectId != null && payload.projectId != null && payload.projectId != configuredProjectId) return null
        return when (payload.audience) {
            PushAudience.CUSTOMER -> PushDestination.CustomerChat(payload.conversationId)
            PushAudience.AGENT -> PushDestination.AgentConversation(payload.conversationId)
        }
    }

    /** Agent pushes use their own channel so staff can tune them apart from customer replies. */
    fun channelId(audience: PushAudience, customerChannelId: String, agentChannelId: String = AGENT_CHANNEL_ID): String =
        when (audience) {
            PushAudience.CUSTOMER -> customerChannelId
            PushAudience.AGENT -> agentChannelId
        }

    /**
     * False when the conversation the push is about is already on screen in the
     * matching view (customer chat for customer pushes, agent view for agent pushes).
     */
    fun shouldShow(
        destination: PushDestination,
        visibleCustomerConversationId: String?,
        visibleAgentConversationId: String?,
        showWhenVisible: Boolean,
    ): Boolean {
        if (showWhenVisible) return true
        return when (destination) {
            is PushDestination.CustomerChat -> destination.conversationId != visibleCustomerConversationId
            is PushDestination.AgentConversation -> destination.conversationId != visibleAgentConversationId
        }
    }

    /** Notification id per view, so a customer and an agent notification of one conversation do not replace each other. */
    fun notificationId(destination: PushDestination): Int = when (destination) {
        is PushDestination.CustomerChat -> destination.conversationId.hashCode()
        is PushDestination.AgentConversation -> ("agent:" + destination.conversationId).hashCode()
    }
}

internal object NotificationPayload {
    const val LINK_SCHEME: String = "clayver"
    private const val LINK_PREFIX = "clayver://conversation/"

    /** True when the data block carries the Clayver marker (`"clayver": "1"`). */
    fun isClayver(data: Map<String, Any?>?): Boolean = data?.get("clayver")?.toString() == "1"

    /**
     * Parses a push data block. Returns null when it is not a Clayver push or
     * does not reference a conversation (neither `conversationId` nor a
     * `clayver://conversation/{id}` link).
     */
    fun parse(data: Map<String, Any?>?): ClayverPushPayload? {
        if (data == null || !isClayver(data)) return null
        val link = data["link"]?.toString()?.takeIf { it.isNotBlank() }
        val conversationId = data["conversationId"]?.toString()?.takeIf { isValidKey(it) }
            ?: conversationIdFromLink(link)
            ?: return null
        return ClayverPushPayload(
            type = data["type"]?.toString()?.takeIf { it.isNotBlank() } ?: "message",
            projectId = data["projectId"]?.toString()?.takeIf { it.isNotBlank() },
            conversationId = conversationId,
            messageId = data["messageId"]?.toString()?.takeIf { isValidKey(it) },
            link = link,
            audience = PushAudience.fromWire(data["audience"]),
        )
    }

    /** Extracts the id from `clayver://conversation/{id}` (query/fragment ignored). */
    fun conversationIdFromLink(link: String?): String? {
        if (link == null || !link.startsWith(LINK_PREFIX)) return null
        val id = link.removePrefix(LINK_PREFIX).substringBefore('?').substringBefore('#').trimEnd('/')
        return id.takeIf { isValidKey(it) }
    }

    fun linkFor(conversationId: String): String = LINK_PREFIX + conversationId

    /** A Realtime Database key: non-empty, no `.`, `#`, `$`, `[`, `]` or `/`, at most 768 bytes. */
    fun isValidKey(key: String): Boolean =
        key.isNotEmpty() && key.length <= 768 && key.none { it in ".#$[]/" || it.code < 0x20 || it.code == 0x7F }
}
