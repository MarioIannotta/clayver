import Foundation
import FirebaseAuth
import FirebaseDatabase

/// Mutable agent-mode state of a `ClayverClient`, guarded by its own lock.
final class ClayverAgentState: @unchecked Sendable {
    private let lock = NSLock()
    private var senderNames: [String: String] = [:]

    func senderName(uid: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        return senderNames[uid]
    }

    func setSenderName(_ name: String, uid: String) {
        lock.lock()
        senderNames[uid] = name
        lock.unlock()
    }
}

/// Remembers which Firebase uid this installation registered under `devices/agents/{uid}`, so a
/// registration can be removed when the role goes away.
enum AgentDeviceStore {
    private static func key(_ appName: String, _ projectId: String) -> String {
        "com.clayver.sdk.agentDeviceUid.\(appName).\(projectId)"
    }

    static func registeredUid(appName: String, projectId: String) -> String? {
        UserDefaults.standard.string(forKey: key(appName, projectId))
    }

    static func setRegisteredUid(_ uid: String?, appName: String, projectId: String) {
        if let uid {
            UserDefaults.standard.set(uid, forKey: key(appName, projectId))
        } else {
            UserDefaults.standard.removeObject(forKey: key(appName, projectId))
        }
    }
}

// MARK: - Agent mode

extension ClayverClient {
    // MARK: Role

    func agentRole(of user: User, forceRefresh: Bool) async throws -> ClayverAgentRole? {
        let token = try await user.getIDTokenResult(forcingRefresh: forceRefresh)
        return ClayverAgentRole.fromClaims(token.claims, projectId: options.projectId)
    }

    /// The role from the ID token. With `forceRefresh`, grants or revocations made while the app
    /// runs are picked up, and the agent push registration follows them.
    func agentRole(forceRefresh: Bool) async throws -> ClayverAgentRole? {
        let user = try await currentUser()
        let role = try await agentRole(of: user, forceRefresh: forceRefresh)
        if forceRefresh { await syncAgentDevice(user: user, role: role) }
        return role
    }

    /// The signed-in user, if they hold an agent or admin role. Fails early with
    /// `permissionDenied`; the database rules enforce the same on every operation.
    @discardableResult
    func requireAgent() async throws -> User {
        let user = try await currentUser()
        guard try await agentRole(of: user, forceRefresh: false) != nil else {
            throw ClayverError.permissionDenied
        }
        return user
    }

    // MARK: Push

    private func agentDeviceRef(uid: String) -> DatabaseReference {
        database.reference(withPath: paths.agentDevice(uid, deviceId: deviceId))
    }

    /// Writes `devices/agents/{uid}/{deviceId}` when the user is an agent and a push token is
    /// known; removes this installation's registration when the role is gone. Best-effort.
    func syncAgentDevice(user: User, role: ClayverAgentRole?, fcmToken: String? = nil) async {
        let registeredUid = AgentDeviceStore.registeredUid(appName: app.name, projectId: options.projectId)
        do {
            if role != nil {
                guard let token = fcmToken ?? PushTokenStore.token(appName: app.name) else { return }
                _ = try await agentDeviceRef(uid: user.uid).setValue(deviceRegistration(fcmToken: token, uid: user.uid))
                AgentDeviceStore.setRegisteredUid(user.uid, appName: app.name, projectId: options.projectId)
            } else if registeredUid == user.uid {
                _ = try await agentDeviceRef(uid: user.uid).removeValue()
                AgentDeviceStore.setRegisteredUid(nil, appName: app.name, projectId: options.projectId)
            }
        } catch {
            clayverLog.error("Updating the agent push registration failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Removes this installation's agent registration for `uid` (logout, clearPushToken). Best-effort.
    func removeAgentDevice(uid: String) async {
        let registeredUid = AgentDeviceStore.registeredUid(appName: app.name, projectId: options.projectId)
        guard registeredUid == uid else {
            // Another uid's registration cannot be removed by this user (rules); the function's
            // `tokenIndex` cleans it up when the token is registered again.
            return
        }
        do {
            _ = try await agentDeviceRef(uid: uid).removeValue()
            AgentDeviceStore.setRegisteredUid(nil, appName: app.name, projectId: options.projectId)
        } catch {
            clayverLog.error("Removing the agent push registration failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: Observation

    /// Like `observe`, but checks the agent role before attaching the listener.
    func agentObserve<T>(
        _ makeQuery: @escaping (_ database: Database) -> DatabaseQuery,
        transform: @escaping (DataSnapshot) -> T
    ) -> AsyncThrowingStream<T, Error> {
        AsyncThrowingStream(T.self, bufferingPolicy: .bufferingNewest(1)) { continuation in
            let registration = ObserverRegistration()
            let task = Task {
                do {
                    try await self.requireAgent()
                    try Task.checkCancellation()
                    let query = makeQuery(self.database)
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

    private static func failing<T>(_ error: Error) -> AsyncThrowingStream<T, Error> {
        AsyncThrowingStream { $0.finish(throwing: error) }
    }

    // MARK: Inbox

    /// `orderByChild('statusOrder').startAt('{status}_').endAt('{status}_~').limitToLast(limit)`.
    /// With a `tagId`, the same range is read from `tagIndex/{tagId}` (ordered by value) and each
    /// listed conversation is observed.
    func agentConversations(status: ClayverConversationStatus, limit: Int, tagId: String? = nil) -> AsyncThrowingStream<[ClayverAgentConversation], Error> {
        guard status != .unknown else {
            return Self.failing(ClayverError.invalidArgument("Status must be .open or .closed."))
        }
        if let tagId {
            guard ClayverValidation.isValidDatabaseKey(tagId) else {
                return Self.failing(ClayverError.invalidArgument("Invalid tag id \"\(tagId)\"."))
            }
            return taggedAgentConversations(status: status, limit: limit, tagId: tagId)
        }
        let limit = UInt(max(1, limit))
        let prefix = "\(status.rawValue)_"
        return agentObserve({ [paths] db in
            db.reference(withPath: paths.conversations)
                .queryOrdered(byChild: "statusOrder")
                .queryStarting(atValue: prefix)
                .queryEnding(atValue: prefix + "~")
                .queryLimited(toLast: limit)
        }) { snapshot in
            ClayverParsing.agentConversations(children: snapshot.childPairs)
        }
    }

    /// `tagIndex/{tagId}.orderByValue().startAt('{status}_').endAt('{status}_~').limitToLast(limit)`,
    /// then a listener on each listed `conversations/{id}`. Yields once every listed conversation
    /// has loaded, and again on every change.
    private func taggedAgentConversations(status: ClayverConversationStatus, limit: Int, tagId: String) -> AsyncThrowingStream<[ClayverAgentConversation], Error> {
        let limit = UInt(max(1, limit))
        let prefix = "\(status.rawValue)_"
        return AsyncThrowingStream([ClayverAgentConversation].self, bufferingPolicy: .bufferingNewest(1)) { continuation in
            let observer = TaggedConversationsObserver(database: self.database, paths: self.paths, status: status, continuation: continuation)
            let task = Task {
                do {
                    try await self.requireAgent()
                    try Task.checkCancellation()
                    let query = self.database.reference(withPath: self.paths.tagIndex(tagId))
                        .queryOrderedByValue()
                        .queryStarting(atValue: prefix)
                        .queryEnding(atValue: prefix + "~")
                        .queryLimited(toLast: limit)
                    let handle = query.observe(.value, with: { snapshot in
                        observer.indexChanged(snapshot.childPairs.map { $0.key })
                    }, withCancel: { error in
                        observer.fail(error)
                    })
                    observer.indexRegistration.set(query: query, handle: handle)
                } catch {
                    continuation.finish(throwing: clayverTranslate(error))
                }
            }
            continuation.onTermination = { _ in
                task.cancel()
                observer.stop()
            }
        }
    }

    func agentConversation(id conversationId: String) -> AsyncThrowingStream<ClayverAgentConversation?, Error> {
        guard ClayverValidation.isValidDatabaseKey(conversationId) else {
            return Self.failing(ClayverError.invalidArgument("Invalid conversation id \"\(conversationId)\"."))
        }
        return agentObserve({ [paths] db in db.reference(withPath: paths.conversation(conversationId)) }) { snapshot in
            ClayverParsing.agentConversation(id: conversationId, value: snapshot.value)
        }
    }

    // MARK: Tags

    /// Live `tags` catalog, by name.
    func tags() -> AsyncThrowingStream<[ClayverTag], Error> {
        agentObserve({ [paths] db in db.reference(withPath: paths.tags) }) { snapshot in
            ClayverParsing.tags(children: snapshot.childPairs)
        }
    }

    /// Creates `tags/{slug}` = `{ name, color, createdAt, createdBy }`, or returns the tag that
    /// already has that id. Without a `color`, the palette color of the slug is used.
    func createTag(name rawName: String, color rawColor: String?) async throws -> ClayverTag {
        let name = try ClayverTagRules.normalizedName(rawName)
        var color: String?
        if let rawColor {
            let trimmed = rawColor.trimmingCharacters(in: .whitespacesAndNewlines)
            guard ClayverTagRules.isValidColor(trimmed) else {
                throw ClayverError.invalidArgument("Tag colors must be #rrggbb hex colors.")
            }
            color = trimmed
        }
        let user = try await requireAgent()
        let tagId = ClayverTagRules.tagId(forName: name)
        let ref = database.reference(withPath: paths.tag(tagId))

        let snapshot = try await SingleRead.read(ref)
        if let existing = ClayverParsing.tag(id: tagId, value: snapshot.value) {
            return existing
        }
        try Task.checkCancellation()

        let tag = ClayverTag(id: tagId, name: name, color: color ?? ClayverTagRules.defaultColor(forSlug: tagId))
        do {
            _ = try await ref.setValue([
                "name": tag.name,
                "color": tag.color,
                "createdAt": ServerValue.timestamp(),
                "createdBy": user.uid,
            ] as [String: Any])
        } catch {
            // Another agent may have created the same tag meanwhile; `createdAt` and
            // `createdBy` are immutable, so the rules reject the second write.
            if let latest = try? await SingleRead.read(ref),
               let existing = ClayverParsing.tag(id: tagId, value: latest.value) {
                return existing
            }
            throw error
        }
        return tag
    }

    /// Live ids of the tags on a conversation.
    func conversationTags(conversationId: String) -> AsyncThrowingStream<[String], Error> {
        guard ClayverValidation.isValidDatabaseKey(conversationId) else {
            return Self.failing(ClayverError.invalidArgument("Invalid conversation id \"\(conversationId)\"."))
        }
        return agentObserve({ [paths] db in db.reference(withPath: paths.conversationTags(conversationId)) }) { snapshot in
            ClayverParsing.tagIds(snapshot.value)
        }
    }

    /// `conversationTags/{conversationId}/{tagId} = true`. The rules require the tag and the
    /// conversation to exist.
    func addTag(_ tagId: String, to conversationId: String) async throws {
        try ClayverValidation.validateConversationId(conversationId)
        try Self.validateTagId(tagId)
        try await requireAgent()
        _ = try await database.reference(withPath: paths.conversationTag(conversationId, tagId: tagId)).setValue(true)
    }

    func removeTag(_ tagId: String, from conversationId: String) async throws {
        try ClayverValidation.validateConversationId(conversationId)
        try Self.validateTagId(tagId)
        try await requireAgent()
        _ = try await database.reference(withPath: paths.conversationTag(conversationId, tagId: tagId)).removeValue()
    }

    private static func validateTagId(_ tagId: String) throws {
        guard ClayverValidation.isValidDatabaseKey(tagId) else {
            throw ClayverError.invalidArgument("Invalid tag id \"\(tagId)\".")
        }
    }

    // MARK: Customers

    func customerProfile(customerId: String) -> AsyncThrowingStream<ClayverCustomerProfile, Error> {
        guard ClayverValidation.isValidDatabaseKey(customerId) else {
            return Self.failing(ClayverError.invalidArgument("Invalid customer id \"\(customerId)\"."))
        }
        return agentObserve({ [paths] db in db.reference(withPath: paths.user(customerId)) }) { snapshot in
            ClayverParsing.customerProfile(customerId: customerId, value: snapshot.value)
        }
    }

    func fetchCustomerProfile(customerId: String) async throws -> ClayverCustomerProfile {
        guard ClayverValidation.isValidDatabaseKey(customerId) else {
            throw ClayverError.invalidArgument("Invalid customer id \"\(customerId)\".")
        }
        try await requireAgent()
        let snapshot = try await SingleRead.read(database.reference(withPath: paths.user(customerId)))
        return ClayverParsing.customerProfile(customerId: customerId, value: snapshot.value)
    }

    // MARK: Read markers

    func customerLastReadAtUpdates(conversationId: String) -> AsyncThrowingStream<Date?, Error> {
        guard ClayverValidation.isValidDatabaseKey(conversationId) else {
            return Self.failing(ClayverError.invalidArgument("Invalid conversation id \"\(conversationId)\"."))
        }
        return agentObserve({ [paths] db in db.reference(withPath: paths.customerRead(conversationId)).child("lastReadAt") }) { snapshot in
            ClayverParsing.date(snapshot.value)
        }
    }

    func teamLastReadAt(conversationId: String) async throws -> Date? {
        try ClayverValidation.validateConversationId(conversationId)
        try await requireAgent()
        let snapshot = try await SingleRead.read(database.reference(withPath: paths.agentRead(conversationId)).child("lastReadAt"))
        return ClayverParsing.date(snapshot.value)
    }

    /// `reads/{id}/agent = { lastReadAt: now, uid }`, the shared team read marker.
    func markConversationReadAsAgent(_ conversationId: String) async throws {
        try ClayverValidation.validateConversationId(conversationId)
        let user = try await requireAgent()
        _ = try await database.reference(withPath: paths.agentRead(conversationId)).setValue([
            "lastReadAt": ServerValue.timestamp(),
            "uid": user.uid,
        ] as [String: Any])
    }

    // MARK: Conversation state

    func setConversationStatus(_ conversationId: String, status: ClayverConversationStatus) async throws {
        try ClayverValidation.validateConversationId(conversationId)
        guard status != .unknown else { throw ClayverError.invalidArgument("Status must be .open or .closed.") }
        try await requireAgent()
        _ = try await database.reference(withPath: paths.conversation(conversationId)).child("status").setValue(status.rawValue)
    }

    func assignConversation(_ conversationId: String, toMe: Bool) async throws {
        try ClayverValidation.validateConversationId(conversationId)
        let user = try await requireAgent()
        let ref = database.reference(withPath: paths.conversation(conversationId)).child("assigneeUid")
        if toMe {
            _ = try await ref.setValue(user.uid)
        } else {
            _ = try await ref.removeValue()
        }
    }

    // MARK: Triage

    /// Live `triage/{conversationId}`.
    func triageUpdates(conversationId: String) -> AsyncThrowingStream<ClayverTriage, Error> {
        guard ClayverValidation.isValidDatabaseKey(conversationId) else {
            return Self.failing(ClayverError.invalidArgument("Invalid conversation id \"\(conversationId)\"."))
        }
        return agentObserve({ [paths] db in db.reference(withPath: paths.triage(conversationId)) }) { snapshot in
            ClayverParsing.triage(snapshot.value)
        }
    }

    /// Live `triageOptions`, with the defaults for lists that were never saved.
    func triageOptionsUpdates() -> AsyncThrowingStream<ClayverTriageOptions, Error> {
        agentObserve({ [paths] db in db.reference(withPath: paths.triageOptions) }) { snapshot in
            ClayverParsing.triageOptions(snapshot.value)
        }
    }

    /// `triage/{conversationId}/{priority|stage}` = `optionId`, or removed when `nil`. The rules
    /// accept only ids of the workspace's list (or of the defaults while it was never saved).
    func setTriage(_ conversationId: String, kind: ClayverTriageOption.Kind, optionId: String?) async throws {
        try ClayverValidation.validateConversationId(conversationId)
        if let optionId, !ClayverParsing.isValidTriageOptionId(optionId) {
            throw ClayverError.invalidArgument("Invalid \(kind == .priority ? "priority" : "status") \"\(optionId)\".")
        }
        try await requireAgent()
        let ref = database.reference(withPath: paths.triage(conversationId)).child(kind.rawValue)
        if let optionId {
            _ = try await ref.setValue(optionId)
        } else {
            _ = try await ref.removeValue()
        }
    }

    // MARK: Notes

    /// Live `notes/{conversationId}`, newest first.
    func notes(conversationId: String) -> AsyncThrowingStream<[ClayverInternalNote], Error> {
        guard ClayverValidation.isValidDatabaseKey(conversationId) else {
            return Self.failing(ClayverError.invalidArgument("Invalid conversation id \"\(conversationId)\"."))
        }
        return agentObserve({ [paths] db in db.reference(withPath: paths.notes(conversationId)) }) { snapshot in
            ClayverParsing.notes(conversationId: conversationId, children: snapshot.childPairs)
        }
    }

    /// `notes/{conversationId}/{pushId}` = `{ authorUid, authorName?, text, createdAt }`.
    @discardableResult
    func addNote(_ conversationId: String, text rawText: String) async throws -> String {
        try ClayverValidation.validateConversationId(conversationId)
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw ClayverError.invalidArgument("A note needs text.") }
        guard text.utf16.count <= ClayverValidation.maxTextLength else {
            throw ClayverError.invalidArgument("Notes are limited to \(ClayverValidation.maxTextLength) characters.")
        }
        let user = try await requireAgent()
        let authorName = await agentSenderName(user: user)
        try Task.checkCancellation()
        var note: [String: Any] = [
            "authorUid": user.uid,
            "text": text,
            "createdAt": ServerValue.timestamp(),
        ]
        if let authorName { note["authorName"] = authorName }
        let ref = database.reference(withPath: paths.notes(conversationId)).childByAutoId()
        _ = try await ref.setValue(note)
        return ref.key ?? ""
    }

    /// Removes `notes/{conversationId}/{noteId}`. The rules allow the author and admins.
    func deleteNote(_ conversationId: String, noteId: String) async throws {
        try ClayverValidation.validateConversationId(conversationId)
        guard ClayverValidation.isValidDatabaseKey(noteId) else {
            throw ClayverError.invalidArgument("Invalid note id \"\(noteId)\".")
        }
        try await requireAgent()
        _ = try await database.reference(withPath: paths.note(conversationId, noteId: noteId)).removeValue()
    }

    // MARK: Customer history and blocking

    /// `conversations.orderByChild('customerId').equalTo(customerId)`, newest activity first.
    func customerConversations(customerId: String) -> AsyncThrowingStream<[ClayverAgentConversation], Error> {
        guard ClayverValidation.isValidDatabaseKey(customerId) else {
            return Self.failing(ClayverError.invalidArgument("Invalid customer id \"\(customerId)\"."))
        }
        return agentObserve({ [paths] db in
            db.reference(withPath: paths.conversations)
                .queryOrdered(byChild: "customerId")
                .queryEqual(toValue: customerId)
        }) { snapshot in
            ClayverParsing.agentConversations(children: snapshot.childPairs)
        }
    }

    /// Live active block of a customer, re-evaluated when its `until` passes.
    func customerBlockStatus(customerId: String) -> AsyncThrowingStream<ClayverBlockStatus?, Error> {
        guard ClayverValidation.isValidDatabaseKey(customerId) else {
            return Self.failing(ClayverError.invalidArgument("Invalid customer id \"\(customerId)\"."))
        }
        let records = agentObserve({ [paths] db in db.reference(withPath: paths.moderation(customerId)) }) { snapshot in
            ClayverParsing.moderationRecord(snapshot.value)
        }
        return ClayverBlockStatus.activeUpdates(records)
    }

    /// `moderation/{customerId}` = `{ blocked: true, reason, until?, by: auth.uid, at: now }`.
    /// `rate_limit` is reserved for the functions.
    func blockCustomer(_ customerId: String, reason: ClayverBlockStatus.Reason, until: Date?) async throws {
        guard ClayverValidation.isValidDatabaseKey(customerId) else {
            throw ClayverError.invalidArgument("Invalid customer id \"\(customerId)\".")
        }
        guard reason != .rateLimit else {
            throw ClayverError.invalidArgument("Rate-limit blocks are set automatically.")
        }
        if let until, until <= Date() {
            throw ClayverError.invalidArgument("A block must end in the future.")
        }
        let user = try await requireAgent()
        var record: [String: Any] = [
            "blocked": true,
            "reason": reason.rawValue,
            "by": user.uid,
            "at": ServerValue.timestamp(),
        ]
        if let until { record["until"] = (until.timeIntervalSince1970 * 1000).rounded() }
        _ = try await database.reference(withPath: paths.moderation(customerId)).setValue(record)
    }

    /// Removes `moderation/{customerId}`.
    func unblockCustomer(_ customerId: String) async throws {
        guard ClayverValidation.isValidDatabaseKey(customerId) else {
            throw ClayverError.invalidArgument("Invalid customer id \"\(customerId)\".")
        }
        try await requireAgent()
        _ = try await database.reference(withPath: paths.moderation(customerId)).removeValue()
    }

    /// Live display names of the team (`agents`), by uid.
    func agentNames() -> AsyncThrowingStream<[String: String], Error> {
        agentObserve({ [paths] db in db.reference(withPath: paths.agents) }) { snapshot in
            ClayverParsing.agentNames(snapshot.value)
        }
    }

    // MARK: Replies

    func sendAgentReply(
        conversationId: String,
        text rawText: String?,
        attachment rawAttachment: ClayverAttachmentInput?,
        clientMessageId: String = UUID().uuidString
    ) async throws -> ClayverMessage {
        try ClayverValidation.validateConversationId(conversationId)
        let text = try ClayverValidation.normalizedText(rawText)
        guard text != nil || rawAttachment != nil else {
            throw ClayverError.invalidArgument("A message needs text or an attachment.")
        }
        // Images are re-encoded as JPEG of at most `ClayverAttachmentRules.maxSize`.
        let attachment = try rawAttachment.map { try ClayverAttachmentRules.prepared($0) }
        let clientMessageId = String(clientMessageId.prefix(64))

        let user = try await requireAgent()
        try Task.checkCancellation()

        // Attachments live under the conversation's customer, whoever uploads them.
        let customerSnapshot = try await SingleRead.read(
            database.reference(withPath: paths.conversation(conversationId)).child("customerId")
        )
        guard let customerId = ClayverParsing.string(customerSnapshot.value), !customerId.isEmpty else {
            throw ClayverError.invalidArgument("Conversation \"\(conversationId)\" does not exist.")
        }
        let senderName = await agentSenderName(user: user)
        try Task.checkCancellation()

        let messageRef = database.reference(withPath: paths.messages(conversationId)).childByAutoId()
        var message: [String: Any] = [
            "senderId": user.uid,
            "senderType": "agent",
            "createdAt": ServerValue.timestamp(),
            "clientMessageId": clientMessageId,
        ]
        if let senderName { message["senderName"] = senderName }
        if let text { message["text"] = text }

        var uploaded: ClayverAttachment?
        if let attachment {
            let stored = try await upload(attachment, cid: customerId, conversationId: conversationId)
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

        let messageId = messageRef.key ?? ""
        if let snapshot = try? await SingleRead.read(messageRef),
           let stored = ClayverParsing.message(id: messageId, conversationId: conversationId, value: snapshot.value) {
            return stored
        }
        return ClayverMessage(
            id: messageId,
            conversationId: conversationId,
            senderId: user.uid,
            senderType: .agent,
            senderName: senderName,
            text: text,
            attachment: uploaded,
            createdAt: Date(),
            clientMessageId: clientMessageId
        )
    }

    /// `agents/{uid}/displayName`, else the agent record's email name, else the Firebase
    /// profile's display name or email name. `nil` (the customer then sees "Support") when
    /// none is known. Cached per uid.
    func agentSenderName(user: User) async -> String? {
        if let cached = agentState.senderName(uid: user.uid) { return cached }
        func nonEmpty(_ value: Any?) -> String? {
            guard let string = value as? String else { return nil }
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        func emailName(_ email: String?) -> String? {
            nonEmpty(email?.components(separatedBy: "@").first)
        }
        var record: [String: Any]?
        if let snapshot = try? await SingleRead.read(database.reference(withPath: paths.agent(user.uid))) {
            record = snapshot.value as? [String: Any]
        }
        let candidate = nonEmpty(record?["displayName"])
            ?? nonEmpty(user.displayName)
            ?? emailName(nonEmpty(record?["email"]))
            ?? emailName(user.email)
        guard let candidate else { return nil }
        let name = ClayverValidation.truncatedUTF16(candidate, limit: ClayverValidation.maxSenderNameLength)
        agentState.setSenderName(name, uid: user.uid)
        return name
    }
}

// MARK: - Agent data source backed by the client

/// The `ClayverAgentDataSource` used by the agent views by default. Each call resolves the
/// configured client, so the views can be created before `Clayver.configure` finishes.
struct FirebaseAgentDataSource: ClayverAgentDataSource {
    let resolve: @Sendable () async throws -> ClayverClient

    func currentAgentUid() async throws -> String {
        try await run { try await $0.requireAgent().uid }
    }

    func agentConversations(status: ClayverConversationStatus, limit: Int) -> AsyncThrowingStream<[ClayverAgentConversation], Error> {
        deferredStream(resolve: resolve) { $0.agentConversations(status: status, limit: limit) }
    }

    func conversation(id: String) -> AsyncThrowingStream<ClayverAgentConversation?, Error> {
        deferredStream(resolve: resolve) { $0.agentConversation(id: id) }
    }

    func customerProfile(customerId: String) -> AsyncThrowingStream<ClayverCustomerProfile, Error> {
        deferredStream(resolve: resolve) { $0.customerProfile(customerId: customerId) }
    }

    func fetchCustomerProfile(customerId: String) async throws -> ClayverCustomerProfile {
        try await run { try await $0.fetchCustomerProfile(customerId: customerId) }
    }

    func messages(conversationId: String, limit: Int) -> AsyncThrowingStream<[ClayverMessage], Error> {
        deferredStream(resolve: resolve) { $0.messages(conversationId: conversationId, limit: limit) }
    }

    func loadOlderMessages(conversationId: String, before: String, limit: Int) async throws -> [ClayverMessage] {
        try await run { try await $0.loadOlderMessages(conversationId: conversationId, before: before, limit: limit) }
    }

    func customerLastReadAt(conversationId: String) -> AsyncThrowingStream<Date?, Error> {
        deferredStream(resolve: resolve) { $0.customerLastReadAtUpdates(conversationId: conversationId) }
    }

    func agentLastReadAt(conversationId: String) async throws -> Date? {
        try await run { try await $0.teamLastReadAt(conversationId: conversationId) }
    }

    func sendAgentReply(conversationId: String, text: String?, attachment: ClayverAttachmentInput?, clientMessageId: String) async throws -> ClayverMessage {
        try await run {
            try await $0.sendAgentReply(conversationId: conversationId, text: text, attachment: attachment, clientMessageId: clientMessageId)
        }
    }

    func setConversationStatus(conversationId: String, status: ClayverConversationStatus) async throws {
        try await run { try await $0.setConversationStatus(conversationId, status: status) }
    }

    func assignConversation(conversationId: String, toMe: Bool) async throws {
        try await run { try await $0.assignConversation(conversationId, toMe: toMe) }
    }

    func markConversationReadAsAgent(conversationId: String) async throws {
        try await run { try await $0.markConversationReadAsAgent(conversationId) }
    }

    func attachmentURL(storagePath: String) async throws -> URL {
        try await run { try await $0.attachmentURL(storagePath: storagePath) }
    }

    func agentConversations(status: ClayverConversationStatus, limit: Int, tagId: String?) -> AsyncThrowingStream<[ClayverAgentConversation], Error> {
        deferredStream(resolve: resolve) { $0.agentConversations(status: status, limit: limit, tagId: tagId) }
    }

    func tags() -> AsyncThrowingStream<[ClayverTag], Error> {
        deferredStream(resolve: resolve) { $0.tags() }
    }

    func conversationTags(conversationId: String) -> AsyncThrowingStream<[String], Error> {
        deferredStream(resolve: resolve) { $0.conversationTags(conversationId: conversationId) }
    }

    func createTag(name: String, color: String?) async throws -> ClayverTag {
        try await run { try await $0.createTag(name: name, color: color) }
    }

    func addTag(_ tagId: String, to conversationId: String) async throws {
        try await run { try await $0.addTag(tagId, to: conversationId) }
    }

    func removeTag(_ tagId: String, from conversationId: String) async throws {
        try await run { try await $0.removeTag(tagId, from: conversationId) }
    }

    func triage(conversationId: String) -> AsyncThrowingStream<ClayverTriage, Error> {
        deferredStream(resolve: resolve) { $0.triageUpdates(conversationId: conversationId) }
    }

    func triageOptions() -> AsyncThrowingStream<ClayverTriageOptions, Error> {
        deferredStream(resolve: resolve) { $0.triageOptionsUpdates() }
    }

    func setTriage(conversationId: String, kind: ClayverTriageOption.Kind, optionId: String?) async throws {
        try await run { try await $0.setTriage(conversationId, kind: kind, optionId: optionId) }
    }

    func notes(conversationId: String) -> AsyncThrowingStream<[ClayverInternalNote], Error> {
        deferredStream(resolve: resolve) { $0.notes(conversationId: conversationId) }
    }

    func addNote(conversationId: String, text: String) async throws {
        try await run { _ = try await $0.addNote(conversationId, text: text) }
    }

    func deleteNote(conversationId: String, noteId: String) async throws {
        try await run { try await $0.deleteNote(conversationId, noteId: noteId) }
    }

    func customerConversations(customerId: String) -> AsyncThrowingStream<[ClayverAgentConversation], Error> {
        deferredStream(resolve: resolve) { $0.customerConversations(customerId: customerId) }
    }

    func customerBlockStatus(customerId: String) -> AsyncThrowingStream<ClayverBlockStatus?, Error> {
        deferredStream(resolve: resolve) { $0.customerBlockStatus(customerId: customerId) }
    }

    func blockCustomer(customerId: String, reason: ClayverBlockStatus.Reason, until: Date?) async throws {
        try await run { try await $0.blockCustomer(customerId, reason: reason, until: until) }
    }

    func unblockCustomer(customerId: String) async throws {
        try await run { try await $0.unblockCustomer(customerId) }
    }

    func agentNames() -> AsyncThrowingStream<[String: String], Error> {
        deferredStream(resolve: resolve) { $0.agentNames() }
    }

    private func run<T>(_ body: (ClayverClient) async throws -> T) async throws -> T {
        do {
            return try await body(try await resolve())
        } catch {
            throw clayverTranslate(error)
        }
    }
}

// MARK: - Inbox filtered by tag

/// The state behind `agentConversations(status:limit:tagId:)`: the conversation ids listed by
/// `tagIndex/{tagId}` and a `.value` listener on each of them. Listeners of conversations that
/// leave the index are removed; `stop()` removes all of them.
final class TaggedConversationsObserver: @unchecked Sendable {
    let indexRegistration = ObserverRegistration()

    private let lock = NSLock()
    private let database: Database
    private let paths: ClayverPaths
    private let status: ClayverConversationStatus
    private let continuation: AsyncThrowingStream<[ClayverAgentConversation], Error>.Continuation
    private var ids: [String] = []
    private var registrations: [String: ObserverRegistration] = [:]
    private var conversations: [String: ClayverAgentConversation] = [:]
    private var loadedIds: Set<String> = []
    private var stopped = false

    init(
        database: Database,
        paths: ClayverPaths,
        status: ClayverConversationStatus,
        continuation: AsyncThrowingStream<[ClayverAgentConversation], Error>.Continuation
    ) {
        self.database = database
        self.paths = paths
        self.status = status
        self.continuation = continuation
    }

    /// The index now lists `newIds`: follow the new conversations, drop the others.
    func indexChanged(_ newIds: [String]) {
        lock.lock()
        guard !stopped else {
            lock.unlock()
            return
        }
        let listed = Set(newIds)
        var removed: [ObserverRegistration] = []
        for (id, registration) in registrations where !listed.contains(id) {
            removed.append(registration)
            registrations[id] = nil
            conversations[id] = nil
            loadedIds.remove(id)
        }
        var added: [(id: String, registration: ObserverRegistration)] = []
        for id in newIds where registrations[id] == nil {
            let registration = ObserverRegistration()
            registrations[id] = registration
            added.append((id, registration))
        }
        ids = newIds
        lock.unlock()

        removed.forEach { $0.remove() }
        for (id, registration) in added {
            let ref = database.reference(withPath: paths.conversation(id))
            let handle = ref.observe(.value, with: { [weak self] snapshot in
                self?.conversationChanged(id: id, value: snapshot.value)
            }, withCancel: { [weak self] error in
                self?.fail(error)
            })
            registration.set(query: ref, handle: handle)
        }
        emitIfReady()
    }

    private func conversationChanged(id: String, value: Any?) {
        lock.lock()
        guard !stopped, registrations[id] != nil else {
            lock.unlock()
            return
        }
        conversations[id] = ClayverParsing.agentConversation(id: id, value: value)
        loadedIds.insert(id)
        lock.unlock()
        emitIfReady()
    }

    /// Yields the listed conversations once each of them has loaded. The index can lag behind a
    /// status change for a moment, so conversations with another status are left out.
    private func emitIfReady() {
        lock.lock()
        guard !stopped, ids.allSatisfy({ loadedIds.contains($0) }) else {
            lock.unlock()
            return
        }
        let current = ids.compactMap { conversations[$0] }.filter { $0.status == status }
        lock.unlock()
        continuation.yield(ClayverParsing.sortedNewestFirst(current))
    }

    func fail(_ error: Error) {
        stop()
        continuation.finish(throwing: ClayverError.from(error))
    }

    func stop() {
        lock.lock()
        stopped = true
        let all = Array(registrations.values)
        registrations = [:]
        lock.unlock()
        indexRegistration.remove()
        all.forEach { $0.remove() }
    }
}
