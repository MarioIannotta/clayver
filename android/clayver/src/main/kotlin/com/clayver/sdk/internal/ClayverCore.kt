package com.clayver.sdk.internal

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.util.Log
import com.clayver.sdk.BuildConfig
import com.clayver.sdk.ClayverAgentConversation
import com.clayver.sdk.ClayverAgentRole
import com.clayver.sdk.ClayverAttachment
import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.ClayverBlockReason
import com.clayver.sdk.ClayverBlockStatus
import com.clayver.sdk.ClayverConversation
import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.ClayverCustomerProfile
import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverNote
import com.clayver.sdk.ClayverOptions
import com.clayver.sdk.ClayverPublicConfig
import com.clayver.sdk.ClayverSenderType
import com.clayver.sdk.ClayverTag
import com.clayver.sdk.ClayverTeammate
import com.clayver.sdk.ClayverTriage
import com.clayver.sdk.ClayverTriageOptions
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.storage.FirebaseStorage
import com.google.firebase.storage.StorageMetadata
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.transformLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/**
 * One configured Clayver instance: the Firebase handles plus every data
 * operation. All public entry points in [com.clayver.sdk.Clayver] delegate here.
 * Every path and field written below is defined in firebase/database.schema.md.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class ClayverCore private constructor(
    val appContext: Context,
    val options: ClayverOptions,
    val auth: FirebaseAuth,
    private val database: FirebaseDatabase,
    private val functions: FirebaseFunctions,
    private val storage: FirebaseStorage,
    private val prefs: SharedPreferences,
) {
    val paths = Paths(options.projectId)
    val deviceId: String = loadDeviceId(prefs)

    /** Conversations this device created that may not be in `inbox/` yet, by customer id. */
    private val createdConversations = ConcurrentHashMap<String, String>()
    private val resolveConversationMutex = Mutex()
    private val downloadUrls = ConcurrentHashMap<String, String>()

    /** Agent mode caches: conversation id -> customer id, uid -> reply sender name. */
    private val conversationCustomers = ConcurrentHashMap<String, String>()
    private val agentSenderNames = ConcurrentHashMap<String, String>()

    /** The role last read from the token, with the uid it belongs to. */
    @Volatile private var lastAgentRole: Pair<String, ClayverAgentRole?>? = null

    /** The uid [followAuthState] saw last. */
    @Volatile private var followedUid: String? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private fun ref(path: String): DatabaseReference = database.getReference(path)

    // region identity

    /**
     * The signed-in Firebase user. Without one, signs in anonymously when
     * [ClayverOptions.signInAnonymously] allows it, and throws NOT_AUTHENTICATED otherwise.
     */
    suspend fun ensureSignedIn(): FirebaseUser = clayverCall {
        auth.currentUser?.let { return@clayverCall it }
        if (!options.signInAnonymously) {
            throw ClayverException.notAuthenticated("Sign the user in with Firebase Auth first (signInAnonymously is off).")
        }
        auth.signInAnonymously().await().user
            ?: throw ClayverException.notAuthenticated("Anonymous sign-in returned no user.")
    }

    /** The caller's customer id: the Firebase uid of the signed-in user. */
    fun customerId(): String = auth.currentUser?.uid ?: throw ClayverException.notAuthenticated()

    /** Emits the current customer id (null when signed out) whenever the signed-in user changes. */
    fun customerIdFlow(): Flow<String?> = callbackFlow {
        val listener = FirebaseAuth.AuthStateListener { trySend(it.currentUser?.uid) }
        auth.addAuthStateListener(listener)
        awaitClose { auth.removeAuthStateListener(listener) }
    }.distinctUntilChanged()

    /**
     * Follows the host app's Firebase sign-in. When the signed-in user changes, this
     * installation's push registration moves to the new customer (the function removes the
     * previous user's registration of the same token) and the agent registration follows the
     * new user's role. The listener lives as long as this instance (the whole process).
     */
    private fun followAuthState() {
        followedUid = auth.currentUser?.uid
        auth.addAuthStateListener { a ->
            val uid = a.currentUser?.uid
            if (uid == followedUid) return@addAuthStateListener
            followedUid = uid
            clearUserCaches()
            // Signed out: nothing to register until the next user (or anonymous sign-in).
            if (uid != null) scope.launch { reRegisterStoredPushToken() }
        }
    }

    private fun clearUserCaches() {
        createdConversations.clear()
        downloadUrls.clear()
        conversationCustomers.clear()
        agentSenderNames.clear()
        lastAgentRole = null
    }

    /**
     * Removes this installation's push registrations for the signed-in user. The host app
     * calls it right before signing the user out of Firebase Auth. An anonymous user is
     * signed out here; a host-app user stays signed in (signing out is the host app's call).
     */
    suspend fun logout() {
        val user = auth.currentUser
        try {
            clearPushToken(forgetToken = false)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            Log.w(TAG, "Could not remove the device registration on logout", e)
        }
        clearUserCaches()
        if (user != null && user.isAnonymous) auth.signOut()
    }

    /** `clayverDeleteMyData` erases everything stored for the current customer; then [logout]. */
    suspend fun deleteCustomerData() {
        ensureSignedIn()
        clayverCall {
            functions.getHttpsCallable(FN_DELETE_MY_DATA).call(hashMapOf("projectId" to options.projectId)).await()
        }
        logout()
    }

    // endregion

    // region customer data

    suspend fun setUserProperties(properties: Map<String, Any?>) {
        val values = PropertyValidation.validate(properties)
        if (values.isEmpty()) return
        ensureSignedIn()
        val cid = customerId()
        clayverCall { ref(paths.userProperties(cid)).updateChildren(values).await() }
    }

    suspend fun setPushToken(token: String) {
        if (token.isBlank() || token.length > Validation.MAX_PUSH_TOKEN_LENGTH) {
            throw ClayverException.invalidArgument("Invalid FCM registration token.")
        }
        storePushToken(appContext, token)
        registerDevice(token)
    }

    suspend fun clearPushToken(forgetToken: Boolean = true) {
        if (forgetToken) storePushToken(appContext, null)
        val user = auth.currentUser ?: return
        var failure: Throwable? = null
        try {
            removeAgentDevice()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            failure = e
        }
        clayverCall { ref(paths.customerDevice(user.uid, deviceId)).removeValue().await() }
        failure?.let { throw it.toClayverException() }
    }

    /** Registers the token saved by [setPushToken] / onNewToken under the current customer id. */
    suspend fun reRegisterStoredPushToken() {
        val token = storedPushToken(appContext) ?: return
        try {
            registerDevice(token)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            Log.w(TAG, "Could not register the push token", e)
        }
    }

    /**
     * Registers [token] under `devices/customers/{cid}/{deviceId}` and, when the
     * user holds an agent role, under `devices/agents/{uid}/{deviceId}` too. A
     * user who lost the role has the agent registration removed.
     */
    private suspend fun registerDevice(token: String) {
        val user = ensureSignedIn()
        val cid = customerId()
        var failure: Throwable? = null
        try {
            clayverCall { ref(paths.customerDevice(cid, deviceId)).setValue(deviceRegistration(user, token)).await() }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            failure = e
        }
        syncAgentDevice(user, token)
        failure?.let { throw it }
    }

    private suspend fun syncAgentDevice(user: FirebaseUser, token: String) {
        val role = try {
            agentRole()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            Log.w(TAG, "Could not read the agent role; agent push registration left unchanged", e)
            return
        }
        if (role != null) {
            clayverCall { ref(paths.agentDevice(user.uid, deviceId)).setValue(deviceRegistration(user, token)).await() }
            prefs.edit().putString(KEY_AGENT_DEVICE_UID, user.uid).apply()
        } else {
            removeAgentDevice()
        }
    }

    /** Removes the agent registration this installation wrote, if any (for whichever uid wrote it). */
    private suspend fun removeAgentDevice() {
        val uid = prefs.getString(KEY_AGENT_DEVICE_UID, null) ?: return
        // Only the owner may delete it; another signed-in user leaves it to the function's token dedup.
        if (auth.currentUser?.uid != uid) return
        clayverCall { ref(paths.agentDevice(uid, deviceId)).removeValue().await() }
        prefs.edit().remove(KEY_AGENT_DEVICE_UID).apply()
    }

    private fun deviceRegistration(user: FirebaseUser, token: String): Map<String, Any> {
        val registration = HashMap<String, Any>()
        registration["uid"] = user.uid
        registration["platform"] = "android"
        registration["pushToken"] = token
        registration["active"] = true
        registration["updatedAt"] = ServerValue.TIMESTAMP
        Validation.shortString(BuildConfig.SDK_VERSION)?.let { registration["sdkVersion"] = it }
        Validation.shortString(appVersion())?.let { registration["appVersion"] = it }
        Validation.shortString(Locale.getDefault().toLanguageTag())?.let { registration["locale"] = it }
        return registration
    }

    private fun appVersion(): String? = try {
        val pm = appContext.packageManager
        @Suppress("DEPRECATION")
        val info = if (Build.VERSION.SDK_INT >= 33) {
            pm.getPackageInfo(appContext.packageName, android.content.pm.PackageManager.PackageInfoFlags.of(0))
        } else {
            pm.getPackageInfo(appContext.packageName, 0)
        }
        info.versionName
    } catch (_: Exception) {
        null
    }

    // endregion

    // region inbox

    suspend fun unreadCount(): Int {
        ensureSignedIn()
        val cid = customerId()
        return clayverCall { ModelParsing.long(ref(paths.unreadTotal(cid)).get().await().value)?.toInt() ?: 0 }
    }

    fun unreadCountFlow(): Flow<Int> = customerIdFlow().flatMapLatest { cid ->
        if (cid == null) {
            flowOf(0)
        } else {
            ref(paths.unreadTotal(cid)).valueFlow().map { ModelParsing.long(it.value)?.toInt()?.coerceAtLeast(0) ?: 0 }
        }
    }.distinctUntilChanged()

    fun conversationsFlow(): Flow<List<ClayverConversation>> = customerIdFlow().flatMapLatest { cid ->
        if (cid == null) {
            flowOf(emptyList())
        } else {
            ref(paths.inboxConversations(cid)).valueFlow().map { ModelParsing.conversations(it.value as? Map<*, *>) }
        }
    }

    /**
     * The active block in `moderation/{cid}`, or null; follows identity changes
     * and emits null by itself when a timed block's `until` passes.
     */
    fun blockStatusFlow(): Flow<ClayverBlockStatus?> = customerIdFlow().flatMapLatest { cid ->
        if (cid == null) {
            flowOf<ClayverBlockStatus?>(null)
        } else {
            moderationFlow(cid)
        }
    }.distinctUntilChanged()

    /** The active block in `moderation/{customerId}`, turning null by itself when `until` passes. */
    private fun moderationFlow(customerId: String): Flow<ClayverBlockStatus?> =
        ref(paths.moderation(customerId)).valueFlow().transformLatest<DataSnapshot, ClayverBlockStatus?> { snap ->
            val value = snap.value
            while (true) {
                val now = System.currentTimeMillis()
                emit(ModerationRules.blockStatus(value, now))
                val wait = ModerationRules.millisUntilChange(value, now) ?: break
                delay(wait.coerceAtLeast(1L))
            }
        }.distinctUntilChanged()

    suspend fun publicConfig(): ClayverPublicConfig = clayverCall {
        ModelParsing.publicConfig(ref(paths.publicConfig()).get().await().value)
    }

    // endregion

    // region messages

    fun messagesFlow(conversationId: String, limit: Int): Flow<List<ClayverMessage>> {
        requireConversationId(conversationId)
        if (limit !in 1..500) throw ClayverException.invalidArgument("limit must be 1..500.")
        return ref(paths.messages(conversationId)).orderByKey().limitToLast(limit).valueFlow()
            .map { ModelParsing.messages(conversationId, it.value as? Map<*, *>) }
    }

    suspend fun loadOlderMessages(conversationId: String, beforeMessageId: String, limit: Int): List<ClayverMessage> {
        requireConversationId(conversationId)
        if (!NotificationPayload.isValidKey(beforeMessageId)) throw ClayverException.invalidArgument("Invalid message id.")
        if (limit !in 1..500) throw ClayverException.invalidArgument("limit must be 1..500.")
        return clayverCall {
            val snap = ref(paths.messages(conversationId)).orderByKey().endBefore(beforeMessageId).limitToLast(limit).get().await()
            ModelParsing.messages(conversationId, snap.value as? Map<*, *>)
        }
    }

    fun agentLastReadAtFlow(conversationId: String): Flow<Long?> =
        ref(paths.agentRead(conversationId)).valueFlow().map { ModelParsing.lastReadAt(it.value) }

    suspend fun customerLastReadAt(conversationId: String): Long? = clayverCall {
        ModelParsing.lastReadAt(ref(paths.customerRead(conversationId)).get().await().value)
    }

    suspend fun markConversationRead(conversationId: String) {
        requireConversationId(conversationId)
        ensureSignedIn()
        val cid = customerId()
        clayverCall {
            ref(paths.customerRead(conversationId)).setValue(mapOf("lastReadAt" to ServerValue.TIMESTAMP)).await()
        }
        // Best effort, not awaited: lets the dashboard show when the customer was last active.
        ref(paths.user(cid)).child("lastSeenAt").setValue(ServerValue.TIMESTAMP)
    }

    suspend fun sendMessage(
        text: String?,
        conversationId: String?,
        attachment: ClayverAttachmentInput?,
        clientMessageId: String = DeviceIds.clientMessageId(),
    ): ClayverMessage {
        val body = validateCustomerMessage(text, attachment, clientMessageId)
        conversationId?.let(::requireConversationId)

        ensureSignedIn()
        val cid = customerId()
        val convId = conversationId ?: resolveConversationMutex.withLock { findOpenConversation(cid) ?: createConversation(cid) }

        return clayverCall {
            val uploaded = attachment?.let { upload(cid, convId, it) }
            writeCustomerMessage(cid, convId, body, uploaded, clientMessageId)
        }
    }

    /**
     * Always creates a new conversation with this first message. The attachment
     * is uploaded before the conversation is written, so a failed upload leaves
     * no empty conversation behind.
     */
    suspend fun startConversation(
        text: String?,
        attachment: ClayverAttachmentInput?,
        clientMessageId: String = DeviceIds.clientMessageId(),
    ): ClayverMessage {
        val body = validateCustomerMessage(text, attachment, clientMessageId)
        ensureSignedIn()
        val cid = customerId()
        return clayverCall {
            val conversationRef = ref(paths.conversations()).push()
            val convId = conversationRef.key!!
            val uploaded = attachment?.let { upload(cid, convId, it) }
            resolveConversationMutex.withLock {
                conversationRef.setValue(newConversation(cid)).await()
                createdConversations[cid] = convId
            }
            writeCustomerMessage(cid, convId, body, uploaded, clientMessageId)
        }
    }

    /** Checks a customer message before touching the network; returns the normalised text. */
    private fun validateCustomerMessage(text: String?, attachment: ClayverAttachmentInput?, clientMessageId: String): String? {
        val body = MessageRules.normalizeText(text)
        if (body == null && attachment == null) {
            throw ClayverException.invalidArgument("A message needs text or an attachment.")
        }
        if (clientMessageId.isEmpty() || clientMessageId.length > MessageRules.MAX_CLIENT_MESSAGE_ID_LENGTH) {
            throw ClayverException.invalidArgument("clientMessageId must be 1-64 characters.")
        }
        // Fail fast on the declared type/size (pre-compression limit for raw images).
        attachment?.validateDeclared()
        return body
    }

    private suspend fun writeCustomerMessage(
        cid: String,
        convId: String,
        body: String?,
        uploaded: ClayverAttachment?,
        clientMessageId: String,
    ): ClayverMessage {
        val messageRef = ref(paths.messages(convId)).push()
        val data = HashMap<String, Any>()
        data["senderId"] = cid
        data["senderType"] = ClayverSenderType.CUSTOMER.wireValue // the SDK never writes another sender type
        data["createdAt"] = ServerValue.TIMESTAMP
        data["clientMessageId"] = clientMessageId
        body?.let { data["text"] = it }
        uploaded?.let { data["attachment"] = it.toMap() }
        messageRef.setValue(data).await()
        return ClayverMessage(
            id = messageRef.key!!,
            conversationId = convId,
            senderId = cid,
            senderType = ClayverSenderType.CUSTOMER,
            text = body,
            attachment = uploaded,
            createdAt = System.currentTimeMillis(),
            clientMessageId = clientMessageId,
        )
    }

    private suspend fun findOpenConversation(cid: String): String? {
        val inbox = clayverCall {
            ModelParsing.conversations(ref(paths.inboxConversations(cid)).get().await().value as? Map<*, *>)
        }
        inbox.firstOrNull { it.status == ClayverConversationStatus.OPEN }?.let { return it.id }
        // Created by this device but not indexed by the function yet.
        val created = createdConversations[cid]
        return if (created != null && inbox.none { it.id == created }) created else null
    }

    private suspend fun createConversation(cid: String): String = clayverCall {
        val conversationRef = ref(paths.conversations()).push()
        conversationRef.setValue(newConversation(cid)).await()
        val id = conversationRef.key!!
        createdConversations[cid] = id
        id
    }

    private fun newConversation(cid: String): Map<String, Any> = mapOf(
        "customerId" to cid,
        "status" to ClayverConversationStatus.OPEN.wireValue,
        "createdAt" to ServerValue.TIMESTAMP,
    )

    private suspend fun upload(cid: String, conversationId: String, input: ClayverAttachmentInput): ClayverAttachment {
        // Every image is re-encoded as a JPEG of at most 300 KB (unless fromUri already did),
        // and the real size of the compressed bytes is validated, not the declared one.
        val prepared = input.prepareForUpload()
        val bytes = prepared.bytes
        val contentType = prepared.contentType
        val fileName = prepared.fileName
        val attachmentId = ref(paths.messages(conversationId)).push().key!!
        val path = paths.attachment(cid, conversationId, attachmentId, fileName)
        val metadata = StorageMetadata.Builder().setContentType(contentType).build()
        val task = storage.reference.child(path).putBytes(bytes, metadata)
        try {
            task.await()
        } catch (e: CancellationException) {
            task.cancel()
            throw e
        }
        return ClayverAttachment(path, fileName, contentType, bytes.size.toLong(), prepared.width, prepared.height)
    }

    suspend fun attachmentUrl(storagePath: String): String {
        downloadUrls[storagePath]?.let { return it }
        return clayverCall {
            storage.reference.child(storagePath).downloadUrl.await().toString().also { downloadUrls[storagePath] = it }
        }
    }

    // region agent mode

    /**
     * The caller's role in this workspace from the verified ID token claim
     * `clayver_roles[projectId]`; null without a role or without a user. A
     * forced refresh that finds a different role re-syncs the agent push registration.
     */
    suspend fun agentRole(forceRefresh: Boolean = false): ClayverAgentRole? {
        val user = auth.currentUser ?: return null
        val role = clayverCall {
            AgentRules.roleFromClaims(user.getIdToken(forceRefresh).await().claims, options.projectId)
        }
        val previous = lastAgentRole
        lastAgentRole = user.uid to role
        if (forceRefresh && previous != null && previous.first == user.uid && previous.second != role) {
            reRegisterStoredPushToken()
        }
        return role
    }

    /** Fails fast with PERMISSION_DENIED when the user has no role; the rules would deny anyway. */
    private suspend fun requireAgent(): FirebaseUser {
        val user = auth.currentUser ?: throw ClayverException.notAuthenticated()
        agentRole() ?: throw ClayverException.notAgent(options.projectId)
        return user
    }

    fun currentUid(): String? = auth.currentUser?.uid

    /**
     * Without [tagId]: `conversations` ordered by `statusOrder`. With it:
     * `tagIndex/{tagId}` ordered by value over the same range, then a live
     * listener on each listed conversation.
     */
    fun agentConversationsFlow(
        status: ClayverConversationStatus,
        limit: Int,
        tagId: String? = null,
    ): Flow<List<ClayverAgentConversation>> {
        if (limit !in 1..500) throw ClayverException.invalidArgument("limit must be 1..500.")
        tagId?.let(::requireTagId)
        return flow {
            requireAgent()
            if (tagId == null) {
                val query = ref(paths.conversations())
                    .orderByChild("statusOrder")
                    .startAt(AgentRules.statusOrderStart(status))
                    .endAt(AgentRules.statusOrderEnd(status))
                    .limitToLast(limit)
                emitAll(query.valueFlow().map { snap -> ModelParsing.agentConversations(snap.value as? Map<*, *>) })
            } else {
                val index = ref(paths.tagIndex(tagId))
                    .orderByValue()
                    .startAt(AgentRules.statusOrderStart(status))
                    .endAt(AgentRules.statusOrderEnd(status))
                    .limitToLast(limit)
                val ids = index.valueFlow().map { snap ->
                    (snap.value as? Map<*, *>).orEmpty().keys.filterIsInstance<String>().filter(NotificationPayload::isValidKey).sorted()
                }.distinctUntilChanged()
                emitAll(ids.flatMapLatest { agentConversationsById(it, status) })
            }
        }
    }

    /** Live records of [ids] with [status], newest first; missing ones are skipped. */
    private fun agentConversationsById(
        ids: List<String>,
        status: ClayverConversationStatus,
    ): Flow<List<ClayverAgentConversation>> {
        if (ids.isEmpty()) return flowOf(emptyList())
        val records = ids.map { id ->
            ref(paths.conversation(id)).valueFlow().map { ModelParsing.agentConversation(id, it.value) }
        }
        return combine(records) { all ->
            // The index can trail a status change by a moment; the record is the truth.
            all.filterNotNull()
                .filter { it.status == status }
                .sortedWith(compareByDescending<ClayverAgentConversation> { it.updatedAt }.thenByDescending { it.id })
        }
    }

    /** One conversation record; emits null while it does not exist. */
    fun agentConversationFlow(conversationId: String): Flow<ClayverAgentConversation?> {
        requireConversationId(conversationId)
        return flow {
            requireAgent()
            emitAll(
                ref(paths.conversation(conversationId)).valueFlow().map { snap ->
                    ModelParsing.agentConversation(conversationId, snap.value)?.also {
                        conversationCustomers[conversationId] = it.customerId
                    }
                },
            )
        }
    }

    fun customerProfileFlow(customerId: String): Flow<ClayverCustomerProfile> {
        if (!NotificationPayload.isValidKey(customerId)) throw ClayverException.invalidArgument("Invalid customer id.")
        return flow {
            requireAgent()
            emitAll(ref(paths.user(customerId)).valueFlow().map { ModelParsing.customerProfile(customerId, it.value) })
        }
    }

    /** The customer's read marker, live: agent messages up to it are "Seen". */
    fun customerLastReadAtFlow(conversationId: String): Flow<Long?> =
        ref(paths.customerRead(conversationId)).valueFlow().map { ModelParsing.lastReadAt(it.value) }

    suspend fun agentLastReadAt(conversationId: String): Long? = clayverCall {
        ModelParsing.lastReadAt(ref(paths.agentRead(conversationId)).get().await().value)
    }

    suspend fun sendAgentReply(
        conversationId: String,
        text: String?,
        attachment: ClayverAttachmentInput?,
        clientMessageId: String = DeviceIds.clientMessageId(),
    ): ClayverMessage {
        requireConversationId(conversationId)
        val body = MessageRules.normalizeText(text)
        if (body == null && attachment == null) {
            throw ClayverException.invalidArgument("A message needs text or an attachment.")
        }
        if (clientMessageId.isEmpty() || clientMessageId.length > MessageRules.MAX_CLIENT_MESSAGE_ID_LENGTH) {
            throw ClayverException.invalidArgument("clientMessageId must be 1-64 characters.")
        }
        attachment?.validateDeclared()
        val user = requireAgent()
        val senderName = agentSenderName(user)

        return clayverCall {
            val messageRef = ref(paths.messages(conversationId)).push()
            // Attachments live under the conversation's customer, whoever uploads them.
            val uploaded = attachment?.let { upload(conversationCustomerId(conversationId), conversationId, it) }
            val data = HashMap<String, Any>()
            data["senderId"] = user.uid
            data["senderType"] = ClayverSenderType.AGENT.wireValue
            data["createdAt"] = ServerValue.TIMESTAMP
            data["clientMessageId"] = clientMessageId
            senderName?.let { data["senderName"] = it }
            body?.let { data["text"] = it }
            uploaded?.let { data["attachment"] = it.toMap() }
            messageRef.setValue(data).await()
            ClayverMessage(
                id = messageRef.key!!,
                conversationId = conversationId,
                senderId = user.uid,
                senderType = ClayverSenderType.AGENT,
                senderName = senderName,
                text = body,
                attachment = uploaded,
                createdAt = System.currentTimeMillis(),
                clientMessageId = clientMessageId,
            )
        }
    }

    suspend fun setConversationStatus(conversationId: String, status: ClayverConversationStatus) {
        requireConversationId(conversationId)
        requireAgent()
        clayverCall { ref(paths.conversation(conversationId)).child("status").setValue(status.wireValue).await() }
    }

    suspend fun assignConversation(conversationId: String, toMe: Boolean) {
        requireConversationId(conversationId)
        val user = requireAgent()
        val assignee = ref(paths.conversation(conversationId)).child("assigneeUid")
        clayverCall { if (toMe) assignee.setValue(user.uid).await() else assignee.removeValue().await() }
    }

    suspend fun markConversationReadAsAgent(conversationId: String) {
        requireConversationId(conversationId)
        val user = requireAgent()
        clayverCall {
            ref(paths.agentRead(conversationId))
                .setValue(mapOf("lastReadAt" to ServerValue.TIMESTAMP, "uid" to user.uid))
                .await()
        }
    }

    // region tags

    /** The workspace tag catalog (`tags`), sorted by name. */
    fun tagsFlow(): Flow<List<ClayverTag>> = flow {
        requireAgent()
        emitAll(ref(paths.tags()).valueFlow().map { TagRules.tags(it.value as? Map<*, *>) })
    }

    /**
     * Creates `tags/{slug(name)}`, or returns the existing tag with that id.
     * Without [color] the palette color picked by the slug is used.
     */
    suspend fun createTag(name: String, color: String?): ClayverTag {
        val trimmed = TagRules.normalizeName(name)
        val id = TagRules.tagId(trimmed)
        val tagColor = TagRules.colorFor(id, color)
        val user = requireAgent()
        return clayverCall {
            val tagRef = ref(paths.tag(id))
            val existing = TagRules.tag(id, tagRef.get().await().value)
            if (existing != null) {
                existing
            } else {
                tagRef.setValue(
                    mapOf(
                        "name" to trimmed,
                        "color" to tagColor,
                        "createdAt" to ServerValue.TIMESTAMP,
                        "createdBy" to user.uid,
                    ),
                ).await()
                ClayverTag(id, trimmed, tagColor)
            }
        }
    }

    /** The tag ids on a conversation (`conversationTags/{id}`), sorted. */
    fun conversationTagsFlow(conversationId: String): Flow<List<String>> {
        requireConversationId(conversationId)
        return flow {
            requireAgent()
            emitAll(ref(paths.conversationTags(conversationId)).valueFlow().map { TagRules.conversationTagIds(it.value) })
        }
    }

    suspend fun addTag(conversationId: String, tagId: String) {
        requireConversationId(conversationId)
        requireTagId(tagId)
        requireAgent()
        clayverCall { ref(paths.conversationTag(conversationId, tagId)).setValue(true).await() }
    }

    suspend fun removeTag(conversationId: String, tagId: String) {
        requireConversationId(conversationId)
        requireTagId(tagId)
        requireAgent()
        clayverCall { ref(paths.conversationTag(conversationId, tagId)).removeValue().await() }
    }

    private fun requireTagId(id: String) {
        if (!TagRules.isValidId(id)) throw ClayverException.invalidArgument("Invalid tag id.")
    }

    // endregion

    // region triage, notes, team and moderation

    /** The workspace's priority and status lists (`triageOptions`), with defaults for lists never saved. */
    fun triageOptionsFlow(): Flow<ClayverTriageOptions> = flow {
        requireAgent()
        emitAll(ref(paths.triageOptions()).valueFlow().map { TriageRules.options(it.value) })
    }.distinctUntilChanged()

    /** A conversation's priority and status (`triage/{id}`). */
    fun triageFlow(conversationId: String): Flow<ClayverTriage> {
        requireConversationId(conversationId)
        return flow {
            requireAgent()
            emitAll(ref(paths.triage(conversationId)).valueFlow().map { TriageRules.triage(it.value) })
        }.distinctUntilChanged()
    }

    /** Sets `triage/{id}/{field}` to [optionId], or removes it when null. */
    suspend fun setTriage(conversationId: String, field: String, optionId: String?) {
        requireConversationId(conversationId)
        if (optionId != null && !TriageRules.isValidOptionId(optionId)) {
            throw ClayverException.invalidArgument("Invalid $field option id.")
        }
        requireAgent()
        val target = ref(paths.triage(conversationId)).child(field)
        clayverCall { if (optionId == null) target.removeValue().await() else target.setValue(optionId).await() }
    }

    /** Internal notes of a conversation, newest first. */
    fun notesFlow(conversationId: String): Flow<List<ClayverNote>> {
        requireConversationId(conversationId)
        return flow {
            requireAgent()
            emitAll(ref(paths.notes(conversationId)).valueFlow().map { TriageRules.notes(conversationId, it.value) })
        }
    }

    suspend fun addNote(conversationId: String, text: String): ClayverNote {
        requireConversationId(conversationId)
        val body = TriageRules.normalizeNote(text)
        val user = requireAgent()
        val authorName = TriageRules.authorName(agentSenderName(user))
        return clayverCall {
            val noteRef = ref(paths.notes(conversationId)).push()
            val data = HashMap<String, Any>()
            data["authorUid"] = user.uid
            data["text"] = body
            data["createdAt"] = ServerValue.TIMESTAMP
            authorName?.let { data["authorName"] = it }
            noteRef.setValue(data).await()
            ClayverNote(noteRef.key!!, conversationId, user.uid, authorName, body, System.currentTimeMillis())
        }
    }

    /** Deletes a note; the rules allow its author or an admin. */
    suspend fun deleteNote(conversationId: String, noteId: String) {
        requireConversationId(conversationId)
        if (!NotificationPayload.isValidKey(noteId)) throw ClayverException.invalidArgument("Invalid note id.")
        requireAgent()
        clayverCall { ref(paths.note(conversationId, noteId)).removeValue().await() }
    }

    /** The support team (`agents`), sorted by name. */
    fun teamFlow(): Flow<List<ClayverTeammate>> = flow {
        requireAgent()
        emitAll(ref(paths.agents()).valueFlow().map { TriageRules.team(it.value) })
    }

    /** A customer's conversations (`conversations` where `customerId` matches), newest first. */
    fun customerConversationsFlow(customerId: String, limit: Int): Flow<List<ClayverAgentConversation>> {
        requireCustomerId(customerId)
        if (limit !in 1..500) throw ClayverException.invalidArgument("limit must be 1..500.")
        return flow {
            requireAgent()
            val query = ref(paths.conversations()).orderByChild("customerId").equalTo(customerId).limitToLast(limit)
            emitAll(query.valueFlow().map { ModelParsing.agentConversations(it.value as? Map<*, *>) })
        }
    }

    /** Agent mode: the active block on [customerId], or null. */
    fun customerBlockStatusFlow(customerId: String): Flow<ClayverBlockStatus?> {
        requireCustomerId(customerId)
        return flow {
            requireAgent()
            emitAll(moderationFlow(customerId))
        }
    }

    /**
     * Blocks [customerId] (`moderation/{customerId}`) until [until] (server
     * time in milliseconds, in the future) or until unblocked when null.
     * [ClayverBlockReason.RATE_LIMIT] is reserved for the functions.
     */
    suspend fun blockCustomer(customerId: String, reason: ClayverBlockReason, until: Long?) {
        requireCustomerId(customerId)
        if (reason == ClayverBlockReason.RATE_LIMIT) {
            throw ClayverException.invalidArgument("rateLimit blocks are set by the functions only.")
        }
        if (until != null && until <= System.currentTimeMillis()) {
            throw ClayverException.invalidArgument("until must be in the future.")
        }
        val user = requireAgent()
        val data = HashMap<String, Any>()
        data["blocked"] = true
        data["reason"] = reason.wireValue
        data["by"] = user.uid
        data["at"] = ServerValue.TIMESTAMP
        until?.let { data["until"] = it }
        clayverCall { ref(paths.moderation(customerId)).setValue(data).await() }
    }

    suspend fun unblockCustomer(customerId: String) {
        requireCustomerId(customerId)
        requireAgent()
        clayverCall { ref(paths.moderation(customerId)).removeValue().await() }
    }

    private fun requireCustomerId(id: String) {
        if (!NotificationPayload.isValidKey(id)) throw ClayverException.invalidArgument("Invalid customer id.")
    }

    // endregion

    private suspend fun conversationCustomerId(conversationId: String): String {
        conversationCustomers[conversationId]?.let { return it }
        val cid = ref(paths.conversation(conversationId)).child("customerId").get().await().value as? String
            ?: throw ClayverException.invalidArgument("Conversation $conversationId does not exist.")
        conversationCustomers[conversationId] = cid
        return cid
    }

    /** `agents/{uid}/displayName`, then the Firebase profile; cached per uid. Never fails the send. */
    private suspend fun agentSenderName(user: FirebaseUser): String? {
        agentSenderNames[user.uid]?.let { return it }
        val stored = try {
            ref(paths.agent(user.uid)).child("displayName").get().await().value as? String
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            Log.w(TAG, "Could not read the agent display name", e)
            null
        }
        val name = AgentRules.senderName(stored, user.displayName, user.email)
        if (name != null && stored != null) agentSenderNames[user.uid] = name
        return name
    }

    // endregion

    private fun requireConversationId(id: String) {
        if (!NotificationPayload.isValidKey(id)) throw ClayverException.invalidArgument("Invalid conversation id.")
    }

    // endregion

    companion object {
        const val TAG = "Clayver"
        const val FN_DELETE_MY_DATA = "clayverDeleteMyData"
        private const val PREFS = "com.clayver.sdk"
        private const val KEY_DEVICE_ID = "deviceId"
        private const val KEY_PUSH_TOKEN = "pushToken"
        private const val KEY_AGENT_DEVICE_UID = "agentDeviceUid"

        fun prefs(context: Context): SharedPreferences =
            context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        fun storePushToken(context: Context, token: String?) {
            prefs(context).edit().apply { if (token == null) remove(KEY_PUSH_TOKEN) else putString(KEY_PUSH_TOKEN, token) }.apply()
        }

        fun storedPushToken(context: Context): String? = prefs(context).getString(KEY_PUSH_TOKEN, null)

        private fun loadDeviceId(prefs: SharedPreferences): String {
            prefs.getString(KEY_DEVICE_ID, null)?.takeIf(Validation::isValidDeviceId)?.let { return it }
            return DeviceIds.generate().also { prefs.edit().putString(KEY_DEVICE_ID, it).apply() }
        }

        suspend fun create(context: Context, options: ClayverOptions): ClayverCore {
            if (!Validation.isValidProjectId(options.projectId)) {
                throw ClayverException.invalidArgument("projectId must match ^[a-z0-9-]{1,40}$.")
            }
            if (options.functionsRegion.isBlank()) throw ClayverException.invalidArgument("functionsRegion is empty.")
            val appContext = context.applicationContext
            val app = resolveApp(appContext, options)
            val auth = FirebaseAuth.getInstance(app)
            val database = options.databaseURL?.let { FirebaseDatabase.getInstance(app, it) } ?: FirebaseDatabase.getInstance(app)
            val functions = FirebaseFunctions.getInstance(app, options.functionsRegion)
            val storage = FirebaseStorage.getInstance(app)
            options.emulator?.let { emu ->
                try {
                    auth.useEmulator(emu.host, emu.authPort)
                    database.useEmulator(emu.host, emu.databasePort)
                    functions.useEmulator(emu.host, emu.functionsPort)
                    storage.useEmulator(emu.host, emu.storagePort)
                } catch (e: IllegalStateException) {
                    Log.w(TAG, "Emulator settings ignored: Firebase was already used before Clayver.configure", e)
                }
            }
            val core = ClayverCore(appContext, options, auth, database, functions, storage, prefs(appContext))
            if (options.signInAnonymously) core.ensureSignedIn()
            core.followAuthState()
            return core
        }

        private fun resolveApp(context: Context, options: ClayverOptions): FirebaseApp {
            options.firebaseApp?.let { return it }
            options.firebaseAppName?.let { name ->
                return try {
                    FirebaseApp.getInstance(name)
                } catch (e: IllegalStateException) {
                    throw ClayverException(ClayverErrorCode.NOT_CONFIGURED, "No FirebaseApp named \"$name\" is initialised.", e)
                }
            }
            FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }?.let { return it }
            return FirebaseApp.initializeApp(context) ?: throw ClayverException(
                ClayverErrorCode.NOT_CONFIGURED,
                "Firebase is not set up: add google-services.json and the com.google.gms.google-services plugin, " +
                    "or pass ClayverOptions(firebaseApp = ...).",
            )
        }
    }
}

internal fun ClayverAttachment.toMap(): Map<String, Any> = buildMap {
    put("storagePath", storagePath)
    put("fileName", fileName)
    put("contentType", contentType)
    put("size", size)
    width?.let { put("width", it) }
    height?.let { put("height", it) }
}
