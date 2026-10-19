package com.clayver.sdk.internal

import com.clayver.sdk.ClayverAgentConversation
import com.clayver.sdk.ClayverAttachment
import com.clayver.sdk.ClayverConversation
import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.ClayverCustomerAccount
import com.clayver.sdk.ClayverCustomerProfile
import com.clayver.sdk.ClayverLastMessage
import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverPublicConfig
import com.clayver.sdk.ClayverSenderType

/**
 * Converts Realtime Database snapshot values (`DataSnapshot.value`: Maps,
 * Strings, Longs, Doubles, Booleans) into SDK models. Malformed records are
 * skipped instead of crashing the listener.
 */
internal object ModelParsing {

    fun message(conversationId: String, id: String, value: Any?): ClayverMessage? {
        val map = value as? Map<*, *> ?: return null
        val senderType = ClayverSenderType.fromWire(map["senderType"]) ?: return null
        val text = map["text"] as? String
        val attachment = attachment(map["attachment"])
        if (text == null && attachment == null) return null
        return ClayverMessage(
            id = id,
            conversationId = conversationId,
            senderId = map["senderId"] as? String ?: "",
            senderType = senderType,
            senderName = map["senderName"] as? String,
            text = text,
            attachment = attachment,
            createdAt = long(map["createdAt"]) ?: 0L,
            clientMessageId = map["clientMessageId"] as? String,
        )
    }

    /** Parses the children of `messages/{conversationId}` in key (= chronological) order. */
    fun messages(conversationId: String, children: Map<*, *>?): List<ClayverMessage> =
        children.orEmpty().entries
            .mapNotNull { (k, v) -> (k as? String)?.let { message(conversationId, it, v) } }
            .sortedBy { it.id }

    fun attachment(value: Any?): ClayverAttachment? {
        val map = value as? Map<*, *> ?: return null
        val path = map["storagePath"] as? String ?: return null
        return ClayverAttachment(
            storagePath = path,
            fileName = map["fileName"] as? String ?: path.substringAfterLast('/'),
            contentType = map["contentType"] as? String ?: "application/octet-stream",
            size = long(map["size"]) ?: 0L,
            width = long(map["width"])?.toInt(),
            height = long(map["height"])?.toInt(),
        )
    }

    /** Parses an `inbox/{cid}/conversations/{id}` entry (or a `conversations/{id}` record). */
    fun conversation(id: String, value: Any?): ClayverConversation? {
        val map = value as? Map<*, *> ?: return null
        val createdAt = long(map["createdAt"]) ?: 0L
        return ClayverConversation(
            id = id,
            status = ClayverConversationStatus.fromWire(map["status"]),
            createdAt = createdAt,
            updatedAt = long(map["updatedAt"]) ?: createdAt,
            lastMessage = lastMessage(map["lastMessage"]),
            unreadCount = unread(map["unread"]),
        )
    }

    /** Newest first. */
    fun conversations(children: Map<*, *>?): List<ClayverConversation> =
        children.orEmpty().entries
            .mapNotNull { (k, v) -> (k as? String)?.let { conversation(it, v) } }
            .sortedWith(compareByDescending<ClayverConversation> { it.updatedAt }.thenByDescending { it.id })

    fun lastMessage(value: Any?): ClayverLastMessage? {
        val map = value as? Map<*, *> ?: return null
        return ClayverLastMessage(
            text = map["text"] as? String,
            senderType = ClayverSenderType.fromWire(map["senderType"]),
            createdAt = long(map["createdAt"]) ?: 0L,
            hasAttachment = map["hasAttachment"] == true,
        )
    }

    /** `unread` is `{ customer, agent }` on conversations; accept a bare number too. */
    fun unread(value: Any?): Int = when (value) {
        is Number -> value.toInt()
        is Map<*, *> -> long(value["customer"])?.toInt() ?: 0
        else -> 0
    }.coerceAtLeast(0)

    /** `unread.agent` of a `conversations/{id}` record. */
    fun unreadForAgents(value: Any?): Int =
        (long((value as? Map<*, *>)?.get("agent"))?.toInt() ?: 0).coerceAtLeast(0)

    /** Parses a `conversations/{id}` record for agents. Records without a `customerId` are skipped. */
    fun agentConversation(id: String, value: Any?): ClayverAgentConversation? {
        val map = value as? Map<*, *> ?: return null
        val customerId = (map["customerId"] as? String)?.takeIf { it.isNotEmpty() } ?: return null
        val createdAt = long(map["createdAt"]) ?: 0L
        return ClayverAgentConversation(
            id = id,
            customerId = customerId,
            status = ClayverConversationStatus.fromWire(map["status"]),
            createdAt = createdAt,
            updatedAt = long(map["updatedAt"]) ?: createdAt,
            lastMessage = lastMessage(map["lastMessage"]),
            unreadForAgents = unreadForAgents(map["unread"]),
            assigneeUid = (map["assigneeUid"] as? String)?.takeIf { it.isNotEmpty() },
        )
    }

    /** The children of a `statusOrder` query, newest first. */
    fun agentConversations(children: Map<*, *>?): List<ClayverAgentConversation> =
        children.orEmpty().entries
            .mapNotNull { (k, v) -> (k as? String)?.let { agentConversation(it, v) } }
            .sortedWith(compareByDescending<ClayverAgentConversation> { it.updatedAt }.thenByDescending { it.id })

    /** Parses `users/{customerId}`; a missing record is an empty profile. */
    fun customerProfile(customerId: String, value: Any?): ClayverCustomerProfile {
        val map = value as? Map<*, *>
        val properties = (map?.get("properties") as? Map<*, *>).orEmpty().entries.mapNotNull { (k, v) ->
            val key = k as? String ?: return@mapNotNull null
            when (v) {
                is String, is Boolean, is Long, is Double -> key to v
                is Number -> key to v.toDouble()
                else -> null
            }
        }.toMap()
        return ClayverCustomerProfile(
            customerId = customerId,
            account = customerAccount(map?.get("account")),
            properties = properties,
            lastSeenAt = long(map?.get("lastSeenAt")),
        )
    }

    /** Parses `users/{customerId}/account`; null when missing or malformed. */
    fun customerAccount(value: Any?): ClayverCustomerAccount? {
        val map = value as? Map<*, *> ?: return null
        val anonymous = map["anonymous"] as? Boolean ?: return null
        return ClayverCustomerAccount(
            anonymous = anonymous,
            email = (map["email"] as? String)?.takeIf { it.isNotBlank() },
            emailVerified = map["emailVerified"] as? Boolean ?: false,
            displayName = (map["displayName"] as? String)?.takeIf { it.isNotBlank() },
        )
    }

    fun publicConfig(value: Any?): ClayverPublicConfig {
        val map = value as? Map<*, *> ?: return ClayverPublicConfig()
        return ClayverPublicConfig(
            teamName = (map["teamName"] as? String)?.takeIf { it.isNotBlank() },
            welcomeMessage = (map["welcomeMessage"] as? String)?.takeIf { it.isNotBlank() },
            accentColor = (map["accentColor"] as? String)?.takeIf { it.isNotBlank() },
        )
    }

    /** `reads/{id}/{side}/lastReadAt`. */
    fun lastReadAt(value: Any?): Long? = long((value as? Map<*, *>)?.get("lastReadAt"))

    fun long(value: Any?): Long? = when (value) {
        is Long -> value
        is Int -> value.toLong()
        is Double -> if (value.isNaN()) null else value.toLong()
        is Number -> value.toLong()
        is String -> value.toLongOrNull()
        else -> null
    }
}
