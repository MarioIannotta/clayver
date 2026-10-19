package com.clayver.sdk.internal

/** Realtime Database and Storage paths from database.schema.md. */
internal class Paths(val projectId: String) {
    val root: String = "clayver/projects/$projectId"

    fun conversation(conversationId: String): String = "$root/conversations/$conversationId"
    fun conversations(): String = "$root/conversations"
    fun messages(conversationId: String): String = "$root/messages/$conversationId"
    fun customerRead(conversationId: String): String = "$root/reads/$conversationId/customer"
    fun agentRead(conversationId: String): String = "$root/reads/$conversationId/agent"
    fun inbox(customerId: String): String = "$root/inbox/$customerId"
    fun unreadTotal(customerId: String): String = "$root/inbox/$customerId/unreadTotal"
    fun inboxConversations(customerId: String): String = "$root/inbox/$customerId/conversations"
    fun user(customerId: String): String = "$root/users/$customerId"
    fun userProperties(customerId: String): String = "$root/users/$customerId/properties"
    fun customerDevice(customerId: String, deviceId: String): String = "$root/devices/customers/$customerId/$deviceId"
    fun publicConfig(): String = "$root/config/public"
    fun agent(uid: String): String = "$root/agents/$uid"
    fun agentDevice(uid: String, deviceId: String): String = "$root/devices/agents/$uid/$deviceId"
    fun moderation(customerId: String): String = "$root/moderation/$customerId"
    fun tags(): String = "$root/tags"
    fun tag(tagId: String): String = "$root/tags/$tagId"
    fun conversationTags(conversationId: String): String = "$root/conversationTags/$conversationId"
    fun conversationTag(conversationId: String, tagId: String): String = "$root/conversationTags/$conversationId/$tagId"
    fun tagIndex(tagId: String): String = "$root/tagIndex/$tagId"
    fun agents(): String = "$root/agents"
    fun triage(conversationId: String): String = "$root/triage/$conversationId"
    fun triageOptions(): String = "$root/triageOptions"
    fun notes(conversationId: String): String = "$root/notes/$conversationId"
    fun note(conversationId: String, noteId: String): String = "$root/notes/$conversationId/$noteId"

    /** `clayver/projects/{projectId}/customers/{customerId}/conversations/{conversationId}/{attachmentId}/{fileName}` */
    fun attachment(customerId: String, conversationId: String, attachmentId: String, fileName: String): String =
        "$root/customers/$customerId/conversations/$conversationId/$attachmentId/$fileName"
}
