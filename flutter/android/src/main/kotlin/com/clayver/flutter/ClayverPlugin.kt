// Copyright (c) Clayver contributors. Licensed under the Apache License 2.0.
//
// Flutter bridge for the Clayver Android SDK. Every call is forwarded to
// `com.clayver.sdk.Clayver`; this file only converts Pigeon types and errors.
// Messaging, push registration, agent mode and the chat/inbox UIs live in the
// native SDK.

package com.clayver.flutter

import android.app.Activity
import android.content.Context
import com.clayver.sdk.Clayver
import com.clayver.sdk.ClayverAgentConversation
import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.ClayverBlockStatus
import com.clayver.sdk.ClayverConversation
import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.ClayverCustomerProfile
import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverLastMessage
import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverTag
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.BinaryMessenger
import java.io.File
import java.io.FileInputStream
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

private const val EVENTS = "dev.flutter.pigeon.clayver.ClayverEventApi"

public class ClayverPlugin : FlutterPlugin, ActivityAware, ClayverHostApi {
    private var context: Context? = null
    private var messenger: BinaryMessenger? = null
    private var activityBinding: ActivityPluginBinding? = null

    /** Lives as long as the engine attachment; cancelled in [onDetachedFromEngine]. */
    private var scope: CoroutineScope? = null

    private val unreadCount = UnreadCountBridge { scope }
    private val conversations = ConversationsBridge { scope }
    private val blockStatus = BlockStatusBridge { scope }
    private val tags = TagsBridge { scope }
    private val messageHandlers = mutableMapOf<String, MessagesBridge>()
    private val agentConversationHandlers = mutableMapOf<String, AgentConversationsBridge>()
    private val profileHandlers = mutableMapOf<String, CustomerProfileBridge>()
    private val conversationTagHandlers = mutableMapOf<String, ConversationTagsBridge>()

    // region FlutterPlugin / ActivityAware

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        context = binding.applicationContext
        messenger = binding.binaryMessenger
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        ClayverHostApi.setUp(binding.binaryMessenger, this)
        UnreadCountStreamHandler.register(binding.binaryMessenger, unreadCount)
        ConversationsStreamHandler.register(binding.binaryMessenger, conversations)
        BlockStatusStreamHandler.register(binding.binaryMessenger, blockStatus)
        TagsStreamHandler.register(binding.binaryMessenger, tags)
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        val messenger = binding.binaryMessenger
        ClayverHostApi.setUp(messenger, null)
        unreadCount.cancel()
        conversations.cancel()
        blockStatus.cancel()
        tags.cancel()
        messenger.setMessageHandler("$EVENTS.unreadCount", null)
        messenger.setMessageHandler("$EVENTS.conversations", null)
        messenger.setMessageHandler("$EVENTS.blockStatus", null)
        messenger.setMessageHandler("$EVENTS.tags", null)
        messageHandlers.keys.toList().forEach(::unregisterMessagesChannel)
        agentConversationHandlers.keys.toList().forEach(::unregisterAgentConversationsChannel)
        profileHandlers.keys.toList().forEach(::unregisterCustomerProfileChannel)
        conversationTagHandlers.keys.toList().forEach(::unregisterConversationTagsChannel)
        // Cancels every pending call and every Flow collection.
        scope?.cancel()
        scope = null
        this.messenger = null
        context = null
    }

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activityBinding = binding
    }

    override fun onDetachedFromActivityForConfigChanges() {
        activityBinding = null
    }

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
        activityBinding = binding
    }

    override fun onDetachedFromActivity() {
        activityBinding = null
    }

    private val activity: Activity? get() = activityBinding?.activity

    // endregion

    // region Host API

    override suspend fun configure(options: ClayverOptionsDto) = bridge {
        val context = requireContext()
        Clayver.configure(context, OptionsMapper.toOptions(context, options))
    }

    override suspend fun logout() = bridge { Clayver.logout() }

    override suspend fun deleteCustomerData() = bridge { Clayver.deleteCustomerData() }

    override suspend fun setUserProperties(properties: Map<String, Any>) = bridge {
        // The standard codec sends Dart ints as Int or Long, doubles as Double,
        // bools as Boolean; the SDK validates keys and values.
        Clayver.setUserProperties(properties)
    }

    override suspend fun setPushToken(token: String) = bridge { Clayver.setPushToken(token) }

    override suspend fun clearPushToken() = bridge { Clayver.clearPushToken() }

    override suspend fun getUnreadMessagesCount(): Long = bridge {
        Clayver.getUnreadMessagesCount().toLong()
    }

    override suspend fun openChat(conversationId: String?) = bridge {
        Clayver.openChat(requireActivity("openChat"), conversationId)
    }

    override suspend fun openConversations() = bridge {
        Clayver.openConversations(requireActivity("openConversations"))
    }

    override suspend fun openNewConversation() = bridge {
        Clayver.openNewConversation(requireActivity("openNewConversation"))
    }

    override suspend fun handleNotification(data: Map<String, String>): Boolean = bridge {
        // Prefer the Activity so the chat opens in the app's task.
        Clayver.handleNotification(activity ?: requireContext(), data)
    }

    override suspend fun loadOlderMessages(
        conversationId: String,
        beforeMessageId: String,
        limit: Long,
    ): List<ClayverMessageDto> = bridge {
        Clayver.loadOlderMessages(conversationId, beforeMessageId, limit.toInt()).map { it.toDto() }
    }

    override suspend fun sendMessage(
        text: String?,
        conversationId: String?,
        attachment: ClayverAttachmentInputDto?,
    ): ClayverMessageDto = bridge {
        Clayver.sendMessage(text, conversationId, attachment?.toInput()).toDto()
    }

    override suspend fun startConversation(
        text: String?,
        attachment: ClayverAttachmentInputDto?,
    ): ClayverMessageDto = bridge {
        Clayver.startConversation(text, attachment?.toInput()).toDto()
    }

    override suspend fun markConversationRead(conversationId: String) = bridge {
        Clayver.markConversationRead(conversationId)
    }

    // region Agent mode

    override suspend fun agentRole(forceRefresh: Boolean): String? = bridge {
        Clayver.agentRole(forceRefresh)?.wireValue
    }

    override suspend fun isAgent(): Boolean = bridge { Clayver.isAgent() }

    override suspend fun openAgentInbox(conversationId: String?) = bridge {
        Clayver.openAgentInbox(requireActivity("openAgentInbox"), conversationId)
    }

    override suspend fun sendAgentReply(
        conversationId: String,
        text: String?,
        attachment: ClayverAttachmentInputDto?,
    ): ClayverMessageDto = bridge {
        Clayver.sendAgentReply(conversationId, text, attachment?.toInput()).toDto()
    }

    override suspend fun setConversationStatus(conversationId: String, status: String) = bridge {
        Clayver.setConversationStatus(conversationId, conversationStatus(status))
    }

    override suspend fun assignConversation(conversationId: String, toMe: Boolean) = bridge {
        Clayver.assignConversation(conversationId, toMe)
    }

    override suspend fun markConversationReadAsAgent(conversationId: String) = bridge {
        Clayver.markConversationReadAsAgent(conversationId)
    }

    override suspend fun createTag(name: String, color: String?): ClayverTagDto = bridge {
        Clayver.createTag(name, color).toDto()
    }

    override suspend fun addTag(conversationId: String, tagId: String) = bridge {
        Clayver.addTag(conversationId, tagId)
    }

    override suspend fun removeTag(conversationId: String, tagId: String) = bridge {
        Clayver.removeTag(conversationId, tagId)
    }

    override fun registerAgentConversationsChannel(
        instanceName: String,
        status: String,
        limit: Long,
        tagId: String?,
    ) {
        val messenger = requireMessenger()
        val nativeStatus = conversationStatus(status)
        if (limit <= 0 || limit > Int.MAX_VALUE) {
            throw ClayverFlutterError(
                ClayverErrorCode.INVALID_ARGUMENT.wireName, "limit must be a positive Int, got $limit.", null,
            )
        }
        unregisterAgentConversationsChannel(instanceName)
        val handler = AgentConversationsBridge(nativeStatus, limit.toInt(), tagId) { scope }
        agentConversationHandlers[instanceName] = handler
        AgentConversationsStreamHandler.register(messenger, handler, instanceName)
    }

    override fun unregisterAgentConversationsChannel(instanceName: String) {
        agentConversationHandlers.remove(instanceName)?.cancel()
        messenger?.setMessageHandler("$EVENTS.agentConversations.$instanceName", null)
    }

    override fun registerCustomerProfileChannel(instanceName: String, customerId: String) {
        val messenger = requireMessenger()
        unregisterCustomerProfileChannel(instanceName)
        val handler = CustomerProfileBridge(customerId) { scope }
        profileHandlers[instanceName] = handler
        CustomerProfileStreamHandler.register(messenger, handler, instanceName)
    }

    override fun unregisterCustomerProfileChannel(instanceName: String) {
        profileHandlers.remove(instanceName)?.cancel()
        messenger?.setMessageHandler("$EVENTS.customerProfile.$instanceName", null)
    }

    override fun registerConversationTagsChannel(instanceName: String, conversationId: String) {
        val messenger = requireMessenger()
        unregisterConversationTagsChannel(instanceName)
        val handler = ConversationTagsBridge(conversationId) { scope }
        conversationTagHandlers[instanceName] = handler
        ConversationTagsStreamHandler.register(messenger, handler, instanceName)
    }

    override fun unregisterConversationTagsChannel(instanceName: String) {
        conversationTagHandlers.remove(instanceName)?.cancel()
        messenger?.setMessageHandler("$EVENTS.conversationTags.$instanceName", null)
    }

    // endregion

    override fun registerMessagesChannel(instanceName: String, conversationId: String) {
        val messenger = requireMessenger()
        unregisterMessagesChannel(instanceName)
        val handler = MessagesBridge(conversationId) { scope }
        messageHandlers[instanceName] = handler
        MessagesStreamHandler.register(messenger, handler, instanceName)
    }

    override fun unregisterMessagesChannel(instanceName: String) {
        messageHandlers.remove(instanceName)?.cancel()
        messenger?.setMessageHandler("$EVENTS.messages.$instanceName", null)
    }

    // endregion

    private fun requireMessenger(): BinaryMessenger = messenger ?: throw ClayverFlutterError(
        ClayverErrorCode.CANCELLED.wireName, "The Flutter engine is detached.",
    )

    private fun requireActivity(method: String): Activity = activity ?: throw ClayverFlutterError(
        ClayverErrorCode.INTERNAL.wireName,
        "$method needs a foreground Activity, but the Flutter engine is not attached to one.",
    )

    private fun requireContext(): Context = context ?: throw ClayverFlutterError(
        ClayverErrorCode.CANCELLED.wireName, "The Flutter engine is detached.",
    )

    /**
     * Runs [block] in the engine-scoped coroutine scope (so detaching the engine
     * cancels it) and maps every failure to a [ClayverFlutterError] carrying a
     * stable Clayver code.
     */
    private suspend fun <T> bridge(block: suspend () -> T): T {
        val scope = scope ?: throw ClayverFlutterError(
            ClayverErrorCode.CANCELLED.wireName, "The Flutter engine is detached.",
        )
        val deferred = scope.async { block() }
        return try {
            deferred.await()
        } catch (e: Throwable) {
            throw e.toFlutterError()
        }
    }
}

// region Errors

internal fun Throwable.toFlutterError(): ClayverFlutterError = when (this) {
    is ClayverFlutterError -> this
    is ClayverException -> ClayverFlutterError(code.wireName, message, null)
    is CancellationException -> ClayverFlutterError(
        ClayverErrorCode.CANCELLED.wireName, message ?: "The operation was cancelled.", null,
    )
    else -> ClayverFlutterError(
        ClayverErrorCode.INTERNAL.wireName, message ?: toString(), null,
    )
}

// endregion

// region Streams

/**
 * Collects one [Flow] per Dart listener in the engine scope and forwards it to
 * a Pigeon event sink on the main thread. [cancel] cancels the collection, which
 * removes the SDK's Firebase listener (`awaitClose`). A failure is sent as one
 * error with a Clayver code, then end-of-stream.
 */
internal class FlowBridge<T, R>(
    private val scope: () -> CoroutineScope?,
    private val flow: () -> Flow<T>,
    private val map: (T) -> R,
) {
    private var job: Job? = null

    fun start(sink: PigeonEventSink<R>) {
        job?.cancel()
        val scope = scope()
        if (scope == null) {
            sink.error(ClayverErrorCode.CANCELLED.wireName, "The Flutter engine is detached.", null)
            sink.endOfStream()
            return
        }
        job = scope.launch {
            try {
                flow().collect { sink.success(map(it)) }
                sink.endOfStream()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                val error = e.toFlutterError()
                sink.error(error.code, error.message, null)
                sink.endOfStream()
            }
        }
    }

    fun cancel() {
        job?.cancel()
        job = null
    }
}

internal class UnreadCountBridge(scope: () -> CoroutineScope?) : UnreadCountStreamHandler() {
    private val bridge = FlowBridge<Int, Long>(scope, { Clayver.unreadCountFlow() }, { it.toLong() })
    override fun onListen(p0: Any?, sink: PigeonEventSink<Long>) = bridge.start(sink)
    override fun onCancel(p0: Any?) = bridge.cancel()
    fun cancel() = bridge.cancel()
}

internal class ConversationsBridge(scope: () -> CoroutineScope?) : ConversationsStreamHandler() {
    private val bridge = FlowBridge<List<ClayverConversation>, List<ClayverConversationDto>>(
        scope,
        { Clayver.conversationsFlow() },
        { list: List<ClayverConversation> -> list.map { it.toDto() } },
    )
    override fun onListen(p0: Any?, sink: PigeonEventSink<List<ClayverConversationDto>>) = bridge.start(sink)
    override fun onCancel(p0: Any?) = bridge.cancel()
    fun cancel() = bridge.cancel()
}

internal class MessagesBridge(
    conversationId: String,
    scope: () -> CoroutineScope?,
) : MessagesStreamHandler() {
    private val bridge = FlowBridge<List<ClayverMessage>, List<ClayverMessageDto>>(
        scope,
        { Clayver.messagesFlow(conversationId) },
        { list: List<ClayverMessage> -> list.map { it.toDto() } },
    )
    override fun onListen(p0: Any?, sink: PigeonEventSink<List<ClayverMessageDto>>) = bridge.start(sink)
    override fun onCancel(p0: Any?) = bridge.cancel()
    fun cancel() = bridge.cancel()
}

internal class AgentConversationsBridge(
    status: ClayverConversationStatus,
    limit: Int,
    tagId: String?,
    scope: () -> CoroutineScope?,
) : AgentConversationsStreamHandler() {
    private val bridge = FlowBridge<List<ClayverAgentConversation>, List<ClayverAgentConversationDto>>(
        scope,
        { Clayver.agentConversationsFlow(status, limit, tagId) },
        { list: List<ClayverAgentConversation> -> list.map { it.toDto() } },
    )
    override fun onListen(p0: Any?, sink: PigeonEventSink<List<ClayverAgentConversationDto>>) = bridge.start(sink)
    override fun onCancel(p0: Any?) = bridge.cancel()
    fun cancel() = bridge.cancel()
}

internal class CustomerProfileBridge(
    customerId: String,
    scope: () -> CoroutineScope?,
) : CustomerProfileStreamHandler() {
    private val bridge = FlowBridge<ClayverCustomerProfile, ClayverCustomerProfileDto>(
        scope,
        { Clayver.customerProfileFlow(customerId) },
        { it.toDto() },
    )
    override fun onListen(p0: Any?, sink: PigeonEventSink<ClayverCustomerProfileDto>) = bridge.start(sink)
    override fun onCancel(p0: Any?) = bridge.cancel()
    fun cancel() = bridge.cancel()
}

internal class BlockStatusBridge(scope: () -> CoroutineScope?) : BlockStatusStreamHandler() {
    private val bridge = FlowBridge<ClayverBlockStatus?, ClayverBlockStateDto>(
        scope,
        { Clayver.blockStatusFlow() },
        { ClayverBlockStateDto(status = it?.toDto()) },
    )
    override fun onListen(p0: Any?, sink: PigeonEventSink<ClayverBlockStateDto>) = bridge.start(sink)
    override fun onCancel(p0: Any?) = bridge.cancel()
    fun cancel() = bridge.cancel()
}

internal class TagsBridge(scope: () -> CoroutineScope?) : TagsStreamHandler() {
    private val bridge = FlowBridge<List<ClayverTag>, List<ClayverTagDto>>(
        scope,
        { Clayver.tagsFlow() },
        { list: List<ClayverTag> -> list.map { it.toDto() } },
    )
    override fun onListen(p0: Any?, sink: PigeonEventSink<List<ClayverTagDto>>) = bridge.start(sink)
    override fun onCancel(p0: Any?) = bridge.cancel()
    fun cancel() = bridge.cancel()
}

internal class ConversationTagsBridge(
    conversationId: String,
    scope: () -> CoroutineScope?,
) : ConversationTagsStreamHandler() {
    private val bridge = FlowBridge<List<String>, List<String>>(
        scope,
        { Clayver.conversationTagsFlow(conversationId) },
        { it },
    )
    override fun onListen(p0: Any?, sink: PigeonEventSink<List<String>>) = bridge.start(sink)
    override fun onCancel(p0: Any?) = bridge.cancel()
    fun cancel() = bridge.cancel()
}

// endregion

// region Conversions

internal fun ClayverTag.toDto(): ClayverTagDto = ClayverTagDto(id = id, name = name, color = color)

/** The stored reason (`rate_limit`, ...); Dart parses it. */
internal fun ClayverBlockStatus.toDto(): ClayverBlockStatusDto =
    ClayverBlockStatusDto(reason = reason.wireValue, until = until)

/** `open` | `closed` to the native status; anything else is `invalidArgument`. */
internal fun conversationStatus(wire: String): ClayverConversationStatus =
    ClayverConversationStatus.entries.firstOrNull { it.wireValue == wire } ?: throw ClayverFlutterError(
        ClayverErrorCode.INVALID_ARGUMENT.wireName, "Conversation status must be open or closed, got \"$wire\".", null,
    )

internal fun ClayverAgentConversation.toDto(): ClayverAgentConversationDto = ClayverAgentConversationDto(
    id = id,
    customerId = customerId,
    status = status.wireValue,
    createdAt = createdAt,
    updatedAt = updatedAt,
    lastMessage = lastMessage?.toDto(),
    unreadForAgents = unreadForAgents.toLong(),
    assigneeUid = assigneeUid,
)

internal fun ClayverCustomerProfile.toDto(): ClayverCustomerProfileDto = ClayverCustomerProfileDto(
    customerId = customerId,
    account = account?.let {
        ClayverCustomerAccountDto(
            anonymous = it.anonymous,
            email = it.email,
            emailVerified = it.emailVerified,
            displayName = it.displayName,
        )
    },
    // String, Long/Double or Boolean: all standard-codec types. Ints are widened
    // so Dart always sees an int.
    properties = properties.mapValues { (_, value) ->
        when (value) {
            is Int -> value.toLong()
            is Float -> value.toDouble()
            else -> value
        }
    },
    lastSeenAt = lastSeenAt,
)

internal fun ClayverLastMessage.toDto(): ClayverLastMessageDto = ClayverLastMessageDto(
    text = text,
    senderType = senderType?.wireValue ?: "unknown",
    createdAt = createdAt,
    hasAttachment = hasAttachment,
)

internal fun ClayverMessage.toDto(): ClayverMessageDto = ClayverMessageDto(
    id = id,
    conversationId = conversationId,
    senderId = senderId,
    senderType = senderType.wireValue,
    senderName = senderName,
    text = text,
    attachment = attachment?.let {
        ClayverAttachmentDto(
            storagePath = it.storagePath,
            fileName = it.fileName,
            contentType = it.contentType,
            size = it.size,
            width = it.width?.toLong(),
            height = it.height?.toLong(),
        )
    },
    createdAt = createdAt,
    clientMessageId = clientMessageId,
)

internal fun ClayverConversation.toDto(): ClayverConversationDto = ClayverConversationDto(
    id = id,
    status = status.wireValue,
    createdAt = createdAt,
    updatedAt = updatedAt,
    lastMessage = lastMessage?.toDto(),
    unreadCount = unreadCount.toLong(),
)

internal fun ClayverAttachmentInputDto.toInput(): ClayverAttachmentInput {
    val bytes = bytes
    val path = filePath
    return when {
        bytes != null -> ClayverAttachmentInput.fromBytes(
            bytes, fileName, contentType, width?.toInt(), height?.toInt(),
        )
        path != null -> {
            val file = File(path)
            if (!file.isFile) {
                throw ClayverFlutterError(
                    ClayverErrorCode.INVALID_ARGUMENT.wireName, "Cannot read attachment file at $path.", null,
                )
            }
            ClayverAttachmentInput.fromStream(
                fileName, contentType, file.length(), width?.toInt(), height?.toInt(),
            ) { FileInputStream(file) }
        }
        else -> throw ClayverFlutterError(
            ClayverErrorCode.INVALID_ARGUMENT.wireName, "An attachment needs either a file path or bytes.", null,
        )
    }
}

// endregion
