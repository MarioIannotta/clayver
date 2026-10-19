import XCTest
@testable import ClayverSDK

/// In-memory `ClayverAgentDataSource` whose streams the tests drive by hand.
final class FakeAgentDataSource: ClayverAgentDataSource, @unchecked Sendable {
    private let lock = NSLock()

    var uid = "agent"
    var uidError: Error?
    var profiles: [String: ClayverCustomerProfile] = [:]
    var teamReadAt: Date?
    var olderPage: [ClayverMessage] = []
    var sendError: Error?
    var actionError: Error?

    private(set) var inboxStreams: [ClayverConversationStatus: AsyncThrowingStream<[ClayverAgentConversation], Error>.Continuation] = [:]
    private(set) var conversationStreams: [String: AsyncThrowingStream<ClayverAgentConversation?, Error>.Continuation] = [:]
    private(set) var profileStreams: [String: AsyncThrowingStream<ClayverCustomerProfile, Error>.Continuation] = [:]
    private(set) var messageStreams: [String: AsyncThrowingStream<[ClayverMessage], Error>.Continuation] = [:]
    private(set) var readStreams: [String: AsyncThrowingStream<Date?, Error>.Continuation] = [:]
    private(set) var profileFetches: [String] = []
    private(set) var sent: [(conversationId: String, text: String?, clientMessageId: String)] = []
    private(set) var statusCalls: [ClayverConversationStatus] = []
    private(set) var assignCalls: [Bool] = []
    private(set) var markReadCalls: [String] = []
    private(set) var taggedInboxStreams: [String: AsyncThrowingStream<[ClayverAgentConversation], Error>.Continuation] = [:]
    private(set) var tagStreams: [AsyncThrowingStream<[ClayverTag], Error>.Continuation] = []
    private(set) var conversationTagStreams: [String: AsyncThrowingStream<[String], Error>.Continuation] = [:]
    private(set) var tagCalls: [(tagId: String, conversationId: String, added: Bool)] = []
    private(set) var createdTags: [ClayverTag] = []

    private func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    func currentAgentUid() async throws -> String {
        try locked { () throws -> String in
            if let uidError { throw uidError }
            return uid
        }
    }

    func agentConversations(status: ClayverConversationStatus, limit: Int) -> AsyncThrowingStream<[ClayverAgentConversation], Error> {
        AsyncThrowingStream { continuation in
            self.locked { self.inboxStreams[status] = continuation }
        }
    }

    func conversation(id: String) -> AsyncThrowingStream<ClayverAgentConversation?, Error> {
        AsyncThrowingStream { continuation in
            self.locked { self.conversationStreams[id] = continuation }
        }
    }

    func customerProfile(customerId: String) -> AsyncThrowingStream<ClayverCustomerProfile, Error> {
        AsyncThrowingStream { continuation in
            self.locked { self.profileStreams[customerId] = continuation }
        }
    }

    func fetchCustomerProfile(customerId: String) async throws -> ClayverCustomerProfile {
        locked {
            profileFetches.append(customerId)
            return profiles[customerId] ?? ClayverCustomerProfile(customerId: customerId, account: nil, properties: [:], lastSeenAt: nil)
        }
    }

    func messages(conversationId: String, limit: Int) -> AsyncThrowingStream<[ClayverMessage], Error> {
        AsyncThrowingStream { continuation in
            self.locked { self.messageStreams[conversationId] = continuation }
        }
    }

    func loadOlderMessages(conversationId: String, before: String, limit: Int) async throws -> [ClayverMessage] {
        locked { olderPage }
    }

    func customerLastReadAt(conversationId: String) -> AsyncThrowingStream<Date?, Error> {
        AsyncThrowingStream { continuation in
            self.locked { self.readStreams[conversationId] = continuation }
        }
    }

    func agentLastReadAt(conversationId: String) async throws -> Date? {
        locked { teamReadAt }
    }

    func sendAgentReply(conversationId: String, text: String?, attachment: ClayverAttachmentInput?, clientMessageId: String) async throws -> ClayverMessage {
        try locked { () throws -> ClayverMessage in
            if let sendError { throw sendError }
            sent.append((conversationId, text, clientMessageId))
            return ClayverMessage(
                id: "-reply\(sent.count)",
                conversationId: conversationId,
                senderId: uid,
                senderType: .agent,
                senderName: "Me",
                text: text,
                createdAt: Date(timeIntervalSince1970: 1_000),
                clientMessageId: clientMessageId
            )
        }
    }

    func setConversationStatus(conversationId: String, status: ClayverConversationStatus) async throws {
        try locked {
            if let actionError { throw actionError }
            statusCalls.append(status)
        }
    }

    func assignConversation(conversationId: String, toMe: Bool) async throws {
        try locked {
            if let actionError { throw actionError }
            assignCalls.append(toMe)
        }
    }

    func markConversationReadAsAgent(conversationId: String) async throws {
        locked { markReadCalls.append(conversationId) }
    }

    func attachmentURL(storagePath: String) async throws -> URL {
        URL(string: "https://example.com/\(storagePath)")!
    }

    func agentConversations(status: ClayverConversationStatus, limit: Int, tagId: String?) -> AsyncThrowingStream<[ClayverAgentConversation], Error> {
        guard let tagId else { return agentConversations(status: status, limit: limit) }
        return AsyncThrowingStream { continuation in
            self.locked { self.taggedInboxStreams[tagId] = continuation }
        }
    }

    func tags() -> AsyncThrowingStream<[ClayverTag], Error> {
        AsyncThrowingStream { continuation in
            self.locked { self.tagStreams.append(continuation) }
        }
    }

    func conversationTags(conversationId: String) -> AsyncThrowingStream<[String], Error> {
        AsyncThrowingStream { continuation in
            self.locked { self.conversationTagStreams[conversationId] = continuation }
        }
    }

    func createTag(name: String, color: String?) async throws -> ClayverTag {
        try locked { () throws -> ClayverTag in
            if let actionError { throw actionError }
            let id = ClayverTagRules.tagId(forName: name)
            let tag = ClayverTag(id: id, name: name, color: color ?? ClayverTagRules.defaultColor(forSlug: id))
            createdTags.append(tag)
            return tag
        }
    }

    func addTag(_ tagId: String, to conversationId: String) async throws {
        try locked {
            if let actionError { throw actionError }
            tagCalls.append((tagId, conversationId, true))
        }
    }

    func removeTag(_ tagId: String, from conversationId: String) async throws {
        try locked {
            if let actionError { throw actionError }
            tagCalls.append((tagId, conversationId, false))
        }
    }

    // Test helpers

    func setActionError(_ error: Error?) { locked { actionError = error } }
    func setSendError(_ error: Error?) { locked { sendError = error } }
    func inbox(_ status: ClayverConversationStatus) -> AsyncThrowingStream<[ClayverAgentConversation], Error>.Continuation? { locked { inboxStreams[status] } }
    func conversationStream(_ id: String) -> AsyncThrowingStream<ClayverAgentConversation?, Error>.Continuation? { locked { conversationStreams[id] } }
    func profileStream(_ id: String) -> AsyncThrowingStream<ClayverCustomerProfile, Error>.Continuation? { locked { profileStreams[id] } }
    func stream(_ id: String) -> AsyncThrowingStream<[ClayverMessage], Error>.Continuation? { locked { messageStreams[id] } }
    func readStream(_ id: String) -> AsyncThrowingStream<Date?, Error>.Continuation? { locked { readStreams[id] } }
    var sentCount: Int { locked { sent.count } }
    var markReadCount: Int { locked { markReadCalls.count } }
    var fetchedProfiles: [String] { locked { profileFetches } }
    func taggedInbox(_ tagId: String) -> AsyncThrowingStream<[ClayverAgentConversation], Error>.Continuation? { locked { taggedInboxStreams[tagId] } }
    var tagStream: AsyncThrowingStream<[ClayverTag], Error>.Continuation? { locked { tagStreams.last } }
    func conversationTagStream(_ id: String) -> AsyncThrowingStream<[String], Error>.Continuation? { locked { conversationTagStreams[id] } }
    var tagCallCount: Int { locked { tagCalls.count } }
}

func agentConversation(
    _ id: String,
    customer: String = "cid",
    status: ClayverConversationStatus = .open,
    updatedAt: TimeInterval = 100,
    unread: Int = 0,
    assignee: String? = nil
) -> ClayverAgentConversation {
    ClayverAgentConversation(
        id: id,
        customerId: customer,
        status: status,
        createdAt: Date(timeIntervalSince1970: 1),
        updatedAt: Date(timeIntervalSince1970: updatedAt),
        lastMessage: ClayverConversation.LastMessage(text: "hi", senderType: .customer, createdAt: nil, hasAttachment: false),
        unreadForAgents: unread,
        assigneeUid: assignee
    )
}

@MainActor
final class AgentInboxViewModelTests: XCTestCase {
    private func waitUntil(_ description: String = "condition", timeout: TimeInterval = 2, _ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline {
                XCTFail("Timed out waiting for \(description)")
                return
            }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
    }

    func testLoadsRowsAndResolvesNames() async throws {
        let fake = FakeAgentDataSource()
        fake.profiles["c1"] = ClayverCustomerProfile(customerId: "c1", account: nil, properties: [Clayver.UserProperty.name: "Ada"], lastSeenAt: nil)
        let model = ClayverAgentInboxViewModel(dataSource: fake)
        model.start()
        XCTAssertEqual(model.loadState, .loading)

        try await waitUntil("inbox stream") { fake.inbox(.open) != nil }
        fake.inbox(.open)?.yield([
            agentConversation("-a", customer: "c1", updatedAt: 100, unread: 2, assignee: "agent"),
            agentConversation("-b", customer: "c2abcdefghij", updatedAt: 200),
        ])
        try await waitUntil("loaded") { model.loadState == .loaded && model.rows.count == 2 }
        XCTAssertEqual(model.agentUid, "agent")
        XCTAssertEqual(model.rows.map(\.id), ["-b", "-a"])
        try await waitUntil("name") { model.rows.last?.customerName == "Ada" }
        XCTAssertTrue(model.rows[1].isAssignedToMe)
        XCTAssertEqual(model.rows[1].unreadCount, 2)
        XCTAssertEqual(model.rows[0].customerName, "c2abcdef")

        // The same customers again: profiles are not fetched twice.
        fake.inbox(.open)?.yield([agentConversation("-a", customer: "c1", updatedAt: 300)])
        try await waitUntil("update") { model.rows.count == 1 }
        XCTAssertEqual(fake.fetchedProfiles.filter { $0 == "c1" }.count, 1)
    }

    func testSwitchingTabsListensToClosed() async throws {
        let fake = FakeAgentDataSource()
        let model = ClayverAgentInboxViewModel(dataSource: fake)
        model.start()
        try await waitUntil("open stream") { fake.inbox(.open) != nil }
        fake.inbox(.open)?.yield([agentConversation("-a")])
        try await waitUntil("loaded") { model.rows.count == 1 }

        model.select(status: .closed)
        XCTAssertEqual(model.status, .closed)
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertEqual(model.loadState, .loading)
        try await waitUntil("closed stream") { fake.inbox(.closed) != nil }
        fake.inbox(.closed)?.yield([])
        try await waitUntil("loaded empty") { model.loadState == .loaded }
        XCTAssertTrue(model.rows.isEmpty)

        // A late update from the old tab is ignored.
        fake.inbox(.open)?.yield([agentConversation("-late")])
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertTrue(model.rows.isEmpty)
    }

    func testNonAgentShowsPermissionError() async throws {
        let fake = FakeAgentDataSource()
        fake.uidError = ClayverError.permissionDenied
        let model = ClayverAgentInboxViewModel(dataSource: fake)
        model.start()
        try await waitUntil("failed") { if case .failed = model.loadState { return true } else { return false } }
        XCTAssertEqual(model.loadState, .failed("This account is not a support agent for this workspace."))
    }
}

@MainActor
final class AgentConversationViewModelTests: XCTestCase {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private func waitUntil(_ description: String = "condition", timeout: TimeInterval = 2, _ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline {
                XCTFail("Timed out waiting for \(description)")
                return
            }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
    }

    private func items(_ model: ClayverAgentConversationViewModel) -> [ClayverChatMessageItem] {
        model.rows.compactMap { if case .message(let item) = $0 { return item } else { return nil } }
    }

    private func loadedModel(_ fake: FakeAgentDataSource, messages: [ClayverMessage] = [], conversation: ClayverAgentConversation? = agentConversation("c1")) async throws -> ClayverAgentConversationViewModel {
        let model = ClayverAgentConversationViewModel(dataSource: fake, conversationId: "c1", calendar: calendar)
        model.start()
        try await waitUntil("streams") { fake.stream("c1") != nil && fake.conversationStream("c1") != nil }
        fake.conversationStream("c1")?.yield(conversation)
        fake.stream("c1")?.yield(messages)
        try await waitUntil("loaded") { model.loadState == .loaded && model.conversation == conversation }
        return model
    }

    func testAgentPerspectiveLayoutAndCustomerName() async throws {
        let fake = FakeAgentDataSource()
        let model = try await loadedModel(fake, messages: [message("-a", .customer, at: 10), message("-b", .agent, at: 20)])
        XCTAssertEqual(items(model).map(\.isOutgoing), [false, true])
        XCTAssertEqual(model.agentUid, "agent")

        XCTAssertEqual(model.customerName, "cid")
        try await waitUntil("profile stream") { fake.profileStream("cid") != nil }
        fake.profileStream("cid")?.yield(ClayverCustomerProfile(customerId: "cid", account: ClayverCustomerAccount(anonymous: false, email: nil, emailVerified: false, displayName: "user-9"), properties: [:], lastSeenAt: nil))
        try await waitUntil("name") { model.customerName == "user-9" }
        XCTAssertEqual(model.perspective, .agent(myUid: "agent", customerName: "user-9"))
    }

    func testSendReplyReconcilesWithLiveMessage() async throws {
        let fake = FakeAgentDataSource()
        let model = try await loadedModel(fake, messages: [message("-a", .customer, at: 10)])

        model.draft = "  On it  "
        model.sendDraft()
        XCTAssertEqual(model.draft, "")
        let local = try XCTUnwrap(items(model).last)
        XCTAssertEqual(local.delivery, .sending)
        XCTAssertTrue(local.isOutgoing)
        XCTAssertEqual(local.message.senderType, .agent)

        try await waitUntil("sent") { fake.sentCount == 1 }
        XCTAssertEqual(fake.sent[0].conversationId, "c1")
        XCTAssertEqual(fake.sent[0].text, "On it")
        try await waitUntil("confirmed") { items(model).last?.delivery == .sent }

        let clientId = fake.sent[0].clientMessageId
        fake.stream("c1")?.yield([
            message("-a", .customer, at: 10),
            ClayverMessage(id: "-reply1", conversationId: "c1", senderId: "agent", senderType: .agent, senderName: "Me", text: "On it",
                           createdAt: Date(timeIntervalSince1970: 1_000), clientMessageId: clientId),
        ])
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(items(model).map(\.id), ["-a", "-reply1"])
    }

    func testFailedReplyCanBeRetried() async throws {
        let fake = FakeAgentDataSource()
        fake.setSendError(ClayverError.permissionDenied)
        let model = try await loadedModel(fake)
        model.draft = "hello"
        model.sendDraft()
        try await waitUntil("failed") { if case .failed = items(model).first?.delivery { return true } else { return false } }
        fake.setSendError(nil)
        model.retrySend(id: try XCTUnwrap(items(model).first?.id))
        try await waitUntil("sent") { items(model).first?.delivery == .sent }
        XCTAssertEqual(fake.sentCount, 1)
    }

    func testCloseAndReopen() async throws {
        let fake = FakeAgentDataSource()
        let model = try await loadedModel(fake)
        XCTAssertFalse(model.isClosed)

        await model.close()
        XCTAssertEqual(fake.statusCalls, [.closed])
        XCTAssertTrue(model.isClosed, "Closing shows immediately")
        XCTAssertFalse(model.isUpdating)

        await model.reopen()
        XCTAssertEqual(fake.statusCalls, [.closed, .open])
        XCTAssertFalse(model.isClosed)

        fake.setActionError(ClayverError.network)
        await model.close()
        XCTAssertFalse(model.isClosed, "A failed write is reverted")
        XCTAssertNotNil(model.alertMessage)
    }

    func testAssignToMeAndUnassign() async throws {
        let fake = FakeAgentDataSource()
        let model = try await loadedModel(fake, conversation: agentConversation("c1", assignee: "teammate"))
        XCTAssertTrue(model.isAssigned)
        XCTAssertFalse(model.isAssignedToMe)

        await model.assign(toMe: true)
        XCTAssertEqual(fake.assignCalls, [true])
        XCTAssertTrue(model.isAssignedToMe)

        await model.assign(toMe: false)
        XCTAssertEqual(fake.assignCalls, [true, false])
        XCTAssertFalse(model.isAssigned)

        // The live record wins over the optimistic value.
        fake.conversationStream("c1")?.yield(agentConversation("c1", assignee: "agent"))
        try await waitUntil("live assignee") { model.isAssignedToMe }
    }

    func testMarksReadAsAgentWhenVisible() async throws {
        let fake = FakeAgentDataSource()
        let model = try await loadedModel(fake, messages: [message("-a", .customer, at: 10)])
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(fake.markReadCount, 0, "Not visible yet")

        model.setVisible(true)
        try await waitUntil("marked") { fake.markReadCount == 1 }
        XCTAssertEqual(fake.markReadCalls, ["c1"])

        // A team message does not need a new marker; a new customer message does.
        fake.stream("c1")?.yield([message("-b", .agent, at: 20)])
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(fake.markReadCount, 1)
        fake.stream("c1")?.yield([message("-c", .customer, at: 30)])
        try await waitUntil("marked again") { fake.markReadCount == 2 }

        model.setVisible(false)
        fake.stream("c1")?.yield([message("-d", .customer, at: 40)])
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(fake.markReadCount, 2)
    }

    func testSeenFromCustomerReadMarkerAndDivider() async throws {
        let fake = FakeAgentDataSource()
        fake.teamReadAt = Date(timeIntervalSince1970: 15)
        let model = try await loadedModel(fake, messages: [
            message("-a", .customer, at: 10),
            message("-b", .agent, at: 12),
            message("-c", .customer, at: 20),
            message("-d", .agent, at: 30),
        ])
        let ids = model.rows.map(\.id)
        let divider = try XCTUnwrap(ids.firstIndex(of: ClayverChatRow.newMessagesDivider.id))
        XCTAssertEqual(ids[divider + 1], "-c")

        try await waitUntil("read stream") { fake.readStream("c1") != nil }
        fake.readStream("c1")?.yield(Date(timeIntervalSince1970: 25))
        try await waitUntil("seen") { items(model).filter(\.isSeen).map(\.id) == ["-b"] }
        fake.readStream("c1")?.yield(Date(timeIntervalSince1970: 35))
        try await waitUntil("seen moves") { items(model).filter(\.isSeen).map(\.id) == ["-d"] }
    }

    func testLoadOlder() async throws {
        let fake = FakeAgentDataSource()
        fake.olderPage = [message("-0", .customer, at: 5)]
        let model = ClayverAgentConversationViewModel(dataSource: fake, conversationId: "c1", pageSize: 2, calendar: calendar)
        model.start()
        try await waitUntil("stream") { fake.stream("c1") != nil }
        fake.stream("c1")?.yield([message("-a", .customer, at: 10), message("-b", .agent, at: 20)])
        try await waitUntil("loaded") { model.loadState == .loaded }
        XCTAssertTrue(model.hasOlderMessages)
        await model.loadOlder()
        XCTAssertEqual(items(model).map(\.id), ["-0", "-a", "-b"])
        XCTAssertFalse(model.hasOlderMessages)
    }

    func testNonAgentFails() async throws {
        let fake = FakeAgentDataSource()
        fake.uidError = ClayverError.permissionDenied
        let model = ClayverAgentConversationViewModel(dataSource: fake, conversationId: "c1", calendar: calendar)
        model.start()
        try await waitUntil("failed") { if case .failed = model.loadState { return true } else { return false } }
        XCTAssertNil(fake.stream("c1"))
    }

    func testTriageDefaultsAndFailedWriteReverts() async throws {
        // The fake relies on the protocol defaults: default lists, and triage writes that fail.
        let fake = FakeAgentDataSource()
        let model = try await loadedModel(fake)
        XCTAssertEqual(model.triageOptions, .defaults)
        XCTAssertNil(model.priorityOption)

        await model.setPriority("high")
        XCTAssertNil(model.triage.priority, "A failed write is reverted")
        XCTAssertNotNil(model.alertMessage)
        XCTAssertFalse(model.isUpdatingTriage)

        model.applyServerTriage(ClayverTriage(priority: "medium", stage: "gone"))
        XCTAssertEqual(model.priorityOption?.name, "Medium")
        XCTAssertNil(model.stageOption, "Values not in the list show as none")
    }

    func testAssigneeNameAndNoteOwnership() async throws {
        let fake = FakeAgentDataSource()
        let model = try await loadedModel(fake, conversation: agentConversation("c1", assignee: "agent"))
        XCTAssertEqual(model.assigneeName, "You")
        let mine = ClayverInternalNote(id: "-n1", conversationId: "c1", authorUid: "agent", authorName: "Me", text: "x", createdAt: nil)
        let theirs = ClayverInternalNote(id: "-n2", conversationId: "c1", authorUid: "other", authorName: nil, text: "y", createdAt: nil)
        XCTAssertTrue(model.canDelete(mine))
        XCTAssertFalse(model.canDelete(theirs))
        let sent = await model.addNote("   ")
        XCTAssertFalse(sent, "Blank notes are not sent")
    }
}
