import Foundation
import FirebaseCore
import FirebaseAuth
import FirebaseDatabase
import FirebaseStorage
import FirebaseFunctions
import FirebaseMessaging
#if canImport(UIKit)
import UIKit
#endif

/// The configured SDK: Firebase handles plus the operations behind the `Clayver` facade.
/// Firebase handles are immutable after init; mutable state is guarded by `lock`.
final class ClayverClient: @unchecked Sendable {
    let options: ClayverOptions
    let app: FirebaseApp
    let auth: Auth
    let database: Database
    let functions: Functions
    let storage: Storage
    let paths: ClayverPaths
    let deviceId: String
    /// Agent-mode caches (sender name). See `ClayverClient+Agent.swift`.
    let agentState = ClayverAgentState()

    private let lock = NSLock()
    private var signInTask: Task<User, Error>?
    /// The uid `followAuthState` saw last.
    private var followedUid: String?
    /// The conversation this client created most recently, keyed by customer id. Bridges the
    /// gap until the `inbox` entry written by the Cloud Function shows up.
    private var lastCreatedConversation: (cid: String, id: String)?

    private init(options: ClayverOptions, app: FirebaseApp) {
        self.options = options
        self.app = app
        self.paths = ClayverPaths(projectId: options.projectId)
        self.auth = Auth.auth(app: app)
        if let url = options.databaseURL {
            self.database = Database.database(app: app, url: url)
        } else {
            self.database = Database.database(app: app)
        }
        self.functions = Functions.functions(app: app, region: options.functionsRegion)
        self.storage = Storage.storage(app: app)
        self.deviceId = DeviceIdStore.deviceId(appName: app.name)

        if let emulator = options.useEmulator {
            // Must happen before any other use of these instances.
            auth.useEmulator(withHost: emulator.host, port: emulator.authPort)
            database.useEmulator(withHost: emulator.host, port: emulator.databasePort)
            functions.useEmulator(withHost: emulator.host, port: emulator.functionsPort)
            storage.useEmulator(withHost: emulator.host, port: emulator.storagePort)
        }
    }

    static func make(options: ClayverOptions) async throws -> ClayverClient {
        guard ClayverValidation.isValidProjectId(options.projectId) else {
            throw ClayverError.invalidArgument("Invalid projectId \"\(options.projectId)\". It must match ^[a-z0-9-]{1,40}$.")
        }
        let app: FirebaseApp
        if let provided = options.firebaseApp {
            app = provided
        } else if let existing = FirebaseApp.app() {
            app = existing
        } else {
            app = try await MainActor.run { () throws -> FirebaseApp in
                FirebaseApp.configure()
                guard let configured = FirebaseApp.app() else {
                    throw ClayverError.notConfigured
                }
                return configured
            }
        }
        let client = ClayverClient(options: options, app: app)
        if options.signInAnonymously { _ = try await client.currentUser() }
        client.followAuthState()
        return client
    }

    // MARK: - Identity

    /// The signed-in Firebase user. Without one, signs in anonymously when
    /// `options.signInAnonymously` allows it, and throws `notAuthenticated` otherwise.
    /// Concurrent callers share a single anonymous sign-in.
    func currentUser() async throws -> User {
        if let user = auth.currentUser { return user }
        guard options.signInAnonymously else { throw ClayverError.notAuthenticated }
        let task: Task<User, Error> = lock.locked {
            if let existing = signInTask { return existing }
            let auth = self.auth
            let task = Task { try await auth.signInAnonymously().user }
            signInTask = task
            return task
        }
        defer { lock.locked { signInTask = nil } }
        return try await task.value
    }

    /// The customer id: the Firebase uid of the signed-in user.
    func customerId() async throws -> String {
        try await currentUser().uid
    }

    /// Follows the host app's Firebase sign-in. When the signed-in user changes, this device's
    /// push registration moves to the new customer and the agent registration follows the new
    /// user's role. The listener lives as long as the client (for the whole process).
    private func followAuthState() {
        lock.lock()
        followedUid = auth.currentUser?.uid
        lock.unlock()
        _ = auth.addStateDidChangeListener { [weak self] _, user in
            guard let self else { return }
            Task { await self.userChanged(to: user) }
        }
    }

    func userChanged(to user: User?) async {
        let previous: String? = lock.locked {
            defer { followedUid = user?.uid }
            return followedUid
        }
        guard user?.uid != previous else { return }
        clearLastCreatedConversation()
        // Signed out: nothing to register until the next user (or the next anonymous sign-in).
        guard let user, let token = PushTokenStore.token(appName: app.name) else { return }
        // The function removes the previous user's registration of the same token via `tokenIndex`.
        do { try await registerDevice(fcmToken: token, cid: user.uid, uid: user.uid) } catch {
            clayverLog.error("Registering the push token for the new user failed: \(error.localizedDescription, privacy: .public)")
        }
        let role = try? await agentRole(of: user, forceRefresh: true)
        await syncAgentDevice(user: user, role: role ?? nil, fcmToken: token)
    }

    /// Removes this device's push registrations for the signed-in user. Call it right before
    /// the host app signs the user out of Firebase Auth. An anonymous user is signed out here;
    /// a host-app user stays signed in, because signing out is the host app's call.
    func logout() async throws {
        clearLastCreatedConversation()
        guard let user = auth.currentUser else { return }
        await removeAgentDevice(uid: user.uid)
        do { _ = try await deviceRef(cid: user.uid).removeValue() } catch {
            clayverLog.error("Removing device registration failed: \(error.localizedDescription, privacy: .public)")
        }
        if user.isAnonymous { try auth.signOut() }
    }

    /// Calls `clayverDeleteMyData`, which erases everything stored for the current customer,
    /// then logs out.
    func deleteCustomerData() async throws {
        _ = try await currentUser()
        _ = try await functions.httpsCallable("clayverDeleteMyData").call(["projectId": options.projectId])
        try Task.checkCancellation()
        try await logout()
    }

    // MARK: - Properties

    func setUserProperties(_ properties: [String: ClayverValue]) async throws {
        try ClayverValidation.validateProperties(properties)
        guard !properties.isEmpty else { return }
        let cid = try await customerId()
        let values = properties.mapValues { $0.firebaseValue }
        _ = try await database.reference(withPath: paths.userProperties(cid)).updateChildValues(values)
    }

    // MARK: - Push

    func setAPNSToken(_ token: Data) async throws {
        guard FirebaseApp.app() === app else {
            throw ClayverError.invalidArgument("Push notifications require the default FirebaseApp (FirebaseMessaging only supports the default app). Use setFCMToken(_:) with a token you obtain yourself.")
        }
        await MainActor.run { Messaging.messaging().apnsToken = token }
        let fcmToken = try await Messaging.messaging().token()
        try await setFCMToken(fcmToken)
    }

    func setFCMToken(_ token: String) async throws {
        guard !token.isEmpty, token.count <= ClayverValidation.maxPushTokenLength else {
            throw ClayverError.invalidArgument("Invalid FCM token.")
        }
        PushTokenStore.setToken(token, appName: app.name)
        // Without a user (and without anonymous sign-in), the token is registered on sign-in.
        let user: User
        if let signedIn = auth.currentUser {
            user = signedIn
        } else if options.signInAnonymously {
            user = try await currentUser()
        } else {
            return
        }
        try await registerDevice(fcmToken: token, cid: user.uid, uid: user.uid)
        // Agents also get `devices/agents/{uid}/{deviceId}`, for pushes with `audience: "agent"`.
        do {
            let role = try await agentRole(of: user, forceRefresh: false)
            await syncAgentDevice(user: user, role: role, fcmToken: token)
        } catch {
            clayverLog.error("Reading the agent role failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    func clearPushToken() async throws {
        PushTokenStore.setToken(nil, appName: app.name)
        guard let user = auth.currentUser else { return }
        await removeAgentDevice(uid: user.uid)
        _ = try await deviceRef(cid: user.uid).removeValue()
    }

    private func deviceRef(cid: String) -> DatabaseReference {
        database.reference(withPath: paths.customerDevice(cid, deviceId: deviceId))
    }

    private func registerDevice(fcmToken: String, cid: String, uid: String) async throws {
        _ = try await deviceRef(cid: cid).setValue(deviceRegistration(fcmToken: fcmToken, uid: uid))
    }

    /// The fields of a `devices/customers/...` or `devices/agents/...` registration.
    func deviceRegistration(fcmToken: String, uid: String) -> [String: Any] {
        var registration: [String: Any] = [
            "uid": uid,
            "platform": "ios",
            "pushToken": fcmToken,
            "active": true,
            "updatedAt": ServerValue.timestamp(),
            "sdkVersion": Clayver.sdkVersion,
            "locale": String(Locale.current.identifier.prefix(64)),
        ]
        if let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String {
            registration["appVersion"] = String(version.prefix(64))
        }
        return registration
    }

    // MARK: - Unread / conversations

    func unreadCount() async throws -> Int {
        let cid = try await customerId()
        let snapshot = try await SingleRead.read(database.reference(withPath: paths.inboxUnreadTotal(cid)))
        return ClayverParsing.int(snapshot.value) ?? 0
    }

    func unreadCountUpdates() -> AsyncThrowingStream<Int, Error> {
        observe({ [paths] cid, db in db.reference(withPath: paths.inboxUnreadTotal(cid)) }) { snapshot in
            ClayverParsing.int(snapshot.value) ?? 0
        }
    }

    func conversations() -> AsyncThrowingStream<[ClayverConversation], Error> {
        observe({ [paths] cid, db in db.reference(withPath: paths.inboxConversations(cid)) }) { snapshot in
            ClayverParsing.conversations(snapshot.value)
        }
    }

    private func fetchConversations(cid: String) async throws -> [ClayverConversation] {
        let snapshot = try await SingleRead.read(database.reference(withPath: paths.inboxConversations(cid)))
        return ClayverParsing.conversations(snapshot.value)
    }

    func latestConversationId() async throws -> String? {
        let cid = try await customerId()
        let conversations = try await fetchConversations(cid: cid)
        if let id = ClayverParsing.preferredConversationId(conversations) { return id }
        return lastCreatedConversationId(cid: cid)
    }

    // MARK: - Messages

    func messages(conversationId: String, limit: Int = 30) -> AsyncThrowingStream<[ClayverMessage], Error> {
        guard ClayverValidation.isValidDatabaseKey(conversationId) else {
            return AsyncThrowingStream { $0.finish(throwing: ClayverError.invalidArgument("Invalid conversation id \"\(conversationId)\".")) }
        }
        let limit = UInt(max(1, limit))
        return observe({ [paths] _, db in
            db.reference(withPath: paths.messages(conversationId)).queryOrderedByKey().queryLimited(toLast: limit)
        }) { snapshot in
            ClayverParsing.messages(conversationId: conversationId, children: snapshot.childPairs)
        }
    }

    func loadOlderMessages(conversationId: String, before: String, limit: Int = 30) async throws -> [ClayverMessage] {
        try ClayverValidation.validateConversationId(conversationId)
        guard !before.isEmpty else { throw ClayverError.invalidArgument("`before` must be a message id.") }
        _ = try await currentUser()
        let query = database.reference(withPath: paths.messages(conversationId))
            .queryOrderedByKey()
            .queryEnding(beforeValue: before)
            .queryLimited(toLast: UInt(max(1, limit)))
        let snapshot = try await SingleRead.read(query)
        return ClayverParsing.messages(conversationId: conversationId, children: snapshot.childPairs)
    }

    func sendMessage(
        text rawText: String?,
        conversationId requestedConversationId: String?,
        attachment rawAttachment: ClayverAttachmentInput?,
        clientMessageId: String = UUID().uuidString,
        startsNewConversation: Bool = false
    ) async throws -> ClayverMessage {
        let text = try ClayverValidation.normalizedText(rawText)
        guard text != nil || rawAttachment != nil else {
            throw ClayverError.invalidArgument("A message needs text or an attachment.")
        }
        // Images are re-encoded as JPEG of at most `ClayverAttachmentRules.maxSize` here, so
        // every caller (chat UI, `Clayver.sendMessage`, the Flutter plugin) uploads the same.
        let attachment = try rawAttachment.map { try ClayverAttachmentRules.prepared($0) }
        if let requestedConversationId { try ClayverValidation.validateConversationId(requestedConversationId) }
        // Everything is validated before a new conversation is written, so no empty one is left.
        let clientMessageId = String(clientMessageId.prefix(64))

        let cid = try await customerId()
        try Task.checkCancellation()

        let conversationId: String
        if let requestedConversationId {
            conversationId = requestedConversationId
        } else if !startsNewConversation, let open = try await openConversationId(cid: cid) {
            conversationId = open
        } else {
            conversationId = try await createConversation(cid: cid)
        }
        try Task.checkCancellation()

        let messageRef = database.reference(withPath: paths.messages(conversationId)).childByAutoId()
        var message: [String: Any] = [
            "senderId": cid,
            "senderType": "customer",
            "createdAt": ServerValue.timestamp(),
            "clientMessageId": clientMessageId,
        ]
        if let text { message["text"] = text }

        var uploaded: ClayverAttachment?
        if let attachment {
            let stored = try await upload(attachment, cid: cid, conversationId: conversationId)
            var dict: [String: Any] = [
                "storagePath": stored.storagePath,
                "fileName": stored.fileName,
                "contentType": stored.contentType,
                "size": stored.size,
            ]
            if let width = stored.width { dict["width"] = width }
            if let height = stored.height { dict["height"] = height }
            message["attachment"] = dict
            uploaded = stored
        }
        try Task.checkCancellation()

        _ = try await messageRef.setValue(message)

        // Read back to get the server-resolved timestamp; fall back to a local estimate.
        let messageId = messageRef.key ?? ""
        if let snapshot = try? await SingleRead.read(messageRef),
           let stored = ClayverParsing.message(id: messageId, conversationId: conversationId, value: snapshot.value) {
            return stored
        }
        return ClayverMessage(
            id: messageId,
            conversationId: conversationId,
            senderId: cid,
            senderType: .customer,
            text: text,
            attachment: uploaded,
            createdAt: Date(),
            clientMessageId: clientMessageId
        )
    }

    /// Sends a message in a new conversation, created for it.
    func startConversation(
        text: String?,
        attachment: ClayverAttachmentInput?,
        clientMessageId: String = UUID().uuidString
    ) async throws -> ClayverMessage {
        try await sendMessage(text: text, conversationId: nil, attachment: attachment,
                              clientMessageId: clientMessageId, startsNewConversation: true)
    }

    private func openConversationId(cid: String) async throws -> String? {
        if let id = ClayverParsing.openConversationId(try await fetchConversations(cid: cid)) { return id }
        return lastCreatedConversationId(cid: cid)
    }

    private func createConversation(cid: String) async throws -> String {
        let ref = database.reference(withPath: paths.conversations).childByAutoId()
        guard let id = ref.key else { throw ClayverError.internal("Could not create a conversation id.") }
        _ = try await ref.setValue([
            "customerId": cid,
            "status": "open",
            "createdAt": ServerValue.timestamp(),
        ] as [String: Any])
        lock.locked { lastCreatedConversation = (cid, id) }
        return id
    }

    private func lastCreatedConversationId(cid: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        guard let last = lastCreatedConversation, last.cid == cid else { return nil }
        return last.id
    }

    private func clearLastCreatedConversation() {
        lock.lock()
        lastCreatedConversation = nil
        lock.unlock()
    }

    /// Uploads an attachment already passed through `ClayverAttachmentRules.prepared`.
    func upload(_ input: ClayverAttachmentInput, cid: String, conversationId: String) async throws -> ClayverAttachment {
        try ClayverAttachmentRules.validate(input)
        let attachmentId = database.reference().childByAutoId().key ?? UUID().uuidString
        let fileName = ClayverAttachmentRules.sanitizedFileName(input.fileName)
        let path = paths.attachment(customerId: cid, conversationId: conversationId, attachmentId: attachmentId, fileName: fileName)
        let metadata = StorageMetadata()
        metadata.contentType = input.contentType
        _ = try await CancellableUpload.put(input.data, to: storage.reference(withPath: path), metadata: metadata)

        var width = input.width
        var height = input.height
        #if canImport(UIKit)
        if input.isImage, width == nil || height == nil, let image = UIImage(data: input.data) {
            width = Int(image.size.width * image.scale)
            height = Int(image.size.height * image.scale)
        }
        #endif
        return ClayverAttachment(
            storagePath: path,
            fileName: fileName,
            contentType: input.contentType,
            size: input.data.count,
            width: width,
            height: height
        )
    }

    func attachmentURL(storagePath: String) async throws -> URL {
        try await storage.reference(withPath: storagePath).downloadURL()
    }

    func markConversationRead(_ conversationId: String) async throws {
        try ClayverValidation.validateConversationId(conversationId)
        _ = try await currentUser()
        _ = try await database.reference(withPath: paths.customerRead(conversationId))
            .setValue(["lastReadAt": ServerValue.timestamp()])
    }

    func agentLastReadAt(conversationId: String) -> AsyncThrowingStream<Date?, Error> {
        observe({ [paths] _, db in db.reference(withPath: paths.agentRead(conversationId)).child("lastReadAt") }) { snapshot in
            ClayverParsing.date(snapshot.value)
        }
    }

    func customerLastReadAt(conversationId: String) async throws -> Date? {
        try ClayverValidation.validateConversationId(conversationId)
        _ = try await currentUser()
        let snapshot = try await SingleRead.read(database.reference(withPath: paths.customerRead(conversationId)).child("lastReadAt"))
        return ClayverParsing.date(snapshot.value)
    }

    /// Live active block from `moderation/{cid}`, re-evaluated when its `until` passes.
    func blockStatus() -> AsyncThrowingStream<ClayverBlockStatus?, Error> {
        let records = observe({ [paths] cid, db in db.reference(withPath: paths.moderation(cid)) }) { snapshot in
            ClayverParsing.moderationRecord(snapshot.value)
        }
        return ClayverBlockStatus.activeUpdates(records)
    }

    func publicConfig() async throws -> ClayverPublicConfig? {
        _ = try await currentUser()
        let snapshot = try await SingleRead.read(database.reference(withPath: paths.publicConfig))
        return ClayverParsing.publicConfig(snapshot.value)
    }

    // MARK: - Observation

    /// Observes `.value` of a query that depends on the customer id. The listener is removed
    /// when the consumer stops iterating (or the task is cancelled).
    func observe<T>(
        _ makeQuery: @escaping (_ cid: String, _ database: Database) -> DatabaseQuery,
        transform: @escaping (DataSnapshot) -> T
    ) -> AsyncThrowingStream<T, Error> {
        AsyncThrowingStream(T.self, bufferingPolicy: .bufferingNewest(1)) { continuation in
            let registration = ObserverRegistration()
            let task = Task {
                do {
                    let cid = try await self.customerId()
                    try Task.checkCancellation()
                    let query = makeQuery(cid, self.database)
                    let handle = query.observe(.value, with: { snapshot in
                        continuation.yield(transform(snapshot))
                    }, withCancel: { error in
                        continuation.finish(throwing: ClayverError.from(error))
                    })
                    registration.set(query: query, handle: handle)
                } catch {
                    continuation.finish(throwing: clayverTranslate(error))
                }
            }
            continuation.onTermination = { _ in
                task.cancel()
                registration.remove()
            }
        }
    }
}

// MARK: - Chat data source backed by the client

/// The `ClayverChatDataSource` used by `ClayverChatView` by default. Each call resolves the
/// configured client, so the view can be created before `Clayver.configure` finishes.
struct FirebaseChatDataSource: ClayverChatDataSource {
    let resolve: @Sendable () async throws -> ClayverClient

    func latestConversationId() async throws -> String? {
        try await run { try await $0.latestConversationId() }
    }

    func messages(conversationId: String, limit: Int) -> AsyncThrowingStream<[ClayverMessage], Error> {
        deferredStream(resolve: resolve) { $0.messages(conversationId: conversationId, limit: limit) }
    }

    func loadOlderMessages(conversationId: String, before: String, limit: Int) async throws -> [ClayverMessage] {
        try await run { try await $0.loadOlderMessages(conversationId: conversationId, before: before, limit: limit) }
    }

    func agentLastReadAt(conversationId: String) -> AsyncThrowingStream<Date?, Error> {
        deferredStream(resolve: resolve) { $0.agentLastReadAt(conversationId: conversationId) }
    }

    func customerLastReadAt(conversationId: String) async throws -> Date? {
        try await run { try await $0.customerLastReadAt(conversationId: conversationId) }
    }

    func sendMessage(text: String?, conversationId: String?, attachment: ClayverAttachmentInput?, clientMessageId: String) async throws -> ClayverMessage {
        try await run {
            try await $0.sendMessage(text: text, conversationId: conversationId, attachment: attachment, clientMessageId: clientMessageId)
        }
    }

    func markConversationRead(conversationId: String) async throws {
        try await run { try await $0.markConversationRead(conversationId) }
    }

    func attachmentURL(storagePath: String) async throws -> URL {
        try await run { try await $0.attachmentURL(storagePath: storagePath) }
    }

    func publicConfig() async throws -> ClayverPublicConfig? {
        try await run { try await $0.publicConfig() }
    }

    func conversations() -> AsyncThrowingStream<[ClayverConversation], Error> {
        deferredStream(resolve: resolve) { $0.conversations() }
    }

    func startConversation(text: String?, attachment: ClayverAttachmentInput?, clientMessageId: String) async throws -> ClayverMessage {
        try await run {
            try await $0.startConversation(text: text, attachment: attachment, clientMessageId: clientMessageId)
        }
    }

    func blockStatus() -> AsyncThrowingStream<ClayverBlockStatus?, Error> {
        deferredStream(resolve: resolve) { $0.blockStatus() }
    }

    private func run<T>(_ body: (ClayverClient) async throws -> T) async throws -> T {
        do {
            return try await body(try await resolve())
        } catch {
            throw clayverTranslate(error)
        }
    }
}
