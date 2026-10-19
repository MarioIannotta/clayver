import XCTest
@testable import ClayverSDK

/// In-memory `ClayverChatDataSource` whose streams the tests drive by hand.
final class FakeChatDataSource: ClayverChatDataSource, @unchecked Sendable {
    private let lock = NSLock()

    var latestId: String?
    var latestError: Error?
    var customerReadAt: Date?
    var olderPage: [ClayverMessage] = []
    var sendError: Error?
    var newConversationId = "c-new"
    var config = ClayverPublicConfig(teamName: "Acme", welcomeMessage: "Hi!", accentColor: nil)

    private(set) var messageStreams: [String: AsyncThrowingStream<[ClayverMessage], Error>.Continuation] = [:]
    private(set) var readStreams: [String: AsyncThrowingStream<Date?, Error>.Continuation] = [:]
    private(set) var sent: [(text: String?, conversationId: String?, clientMessageId: String)] = []
    private(set) var markReadCalls: [String] = []
    private(set) var olderRequests: [String] = []
    private(set) var started: [(text: String?, clientMessageId: String)] = []
    private(set) var listStreams: [AsyncThrowingStream<[ClayverConversation], Error>.Continuation] = []
    private(set) var blockStreams: [AsyncThrowingStream<ClayverBlockStatus?, Error>.Continuation] = []

    private func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    func latestConversationId() async throws -> String? {
        try locked { () throws -> String? in
            if let latestError { throw latestError }
            return latestId
        }
    }

    func messages(conversationId: String, limit: Int) -> AsyncThrowingStream<[ClayverMessage], Error> {
        AsyncThrowingStream { continuation in
            self.locked { self.messageStreams[conversationId] = continuation }
        }
    }

    func loadOlderMessages(conversationId: String, before: String, limit: Int) async throws -> [ClayverMessage] {
        locked {
            olderRequests.append(before)
            return olderPage
        }
    }

    func agentLastReadAt(conversationId: String) -> AsyncThrowingStream<Date?, Error> {
        AsyncThrowingStream { continuation in
            self.locked { self.readStreams[conversationId] = continuation }
        }
    }

    func customerLastReadAt(conversationId: String) async throws -> Date? {
        locked { customerReadAt }
    }

    func sendMessage(text: String?, conversationId: String?, attachment: ClayverAttachmentInput?, clientMessageId: String) async throws -> ClayverMessage {
        try locked { () throws -> ClayverMessage in
            if let sendError { throw sendError }
            sent.append((text, conversationId, clientMessageId))
            return ClayverMessage(
                id: "-sent\(sent.count)",
                conversationId: conversationId ?? newConversationId,
                senderId: "cid",
                senderType: .customer,
                text: text,
                createdAt: Date(timeIntervalSince1970: 1_000),
                clientMessageId: clientMessageId
            )
        }
    }

    func markConversationRead(conversationId: String) async throws {
        locked { markReadCalls.append(conversationId) }
    }

    func attachmentURL(storagePath: String) async throws -> URL {
        URL(string: "https://example.com/\(storagePath)")!
    }

    func publicConfig() async throws -> ClayverPublicConfig? {
        locked { config }
    }

    func conversations() -> AsyncThrowingStream<[ClayverConversation], Error> {
        AsyncThrowingStream { continuation in
            self.locked { self.listStreams.append(continuation) }
        }
    }

    func startConversation(text: String?, attachment: ClayverAttachmentInput?, clientMessageId: String) async throws -> ClayverMessage {
        try locked { () throws -> ClayverMessage in
            if let sendError { throw sendError }
            started.append((text, clientMessageId))
            return ClayverMessage(
                id: "-started\(started.count)",
                conversationId: "c-started\(started.count)",
                senderId: "cid",
                senderType: .customer,
                text: text,
                createdAt: Date(timeIntervalSince1970: 1_000),
                clientMessageId: clientMessageId
            )
        }
    }

    func blockStatus() -> AsyncThrowingStream<ClayverBlockStatus?, Error> {
        AsyncThrowingStream { continuation in
            self.locked { self.blockStreams.append(continuation) }
        }
    }

    // Test helpers

    func setSendError(_ error: Error?) { locked { sendError = error } }
    func setLatest(id: String?, error: Error?) { locked { latestId = id; latestError = error } }
    func stream(_ id: String) -> AsyncThrowingStream<[ClayverMessage], Error>.Continuation? { locked { messageStreams[id] } }
    func readStream(_ id: String) -> AsyncThrowingStream<Date?, Error>.Continuation? { locked { readStreams[id] } }
    var sentCount: Int { locked { sent.count } }
    var startedCount: Int { locked { started.count } }
    var markReadCount: Int { locked { markReadCalls.count } }
    var listStream: AsyncThrowingStream<[ClayverConversation], Error>.Continuation? { locked { listStreams.last } }
    var blockStream: AsyncThrowingStream<ClayverBlockStatus?, Error>.Continuation? { locked { blockStreams.last } }
}

func message(_ id: String, _ sender: ClayverMessage.SenderType, at seconds: TimeInterval, text: String = "text", clientMessageId: String? = nil) -> ClayverMessage {
    ClayverMessage(
        id: id,
        conversationId: "c1",
        senderId: sender == .customer ? "cid" : "agent",
        senderType: sender,
        senderName: sender == .agent ? "Sam" : nil,
        text: text,
        createdAt: Date(timeIntervalSince1970: seconds),
        clientMessageId: clientMessageId
    )
}

@MainActor
final class ChatViewModelTests: XCTestCase {
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

    private func messageItems(_ model: ClayverChatViewModel) -> [ClayverChatMessageItem] {
        model.rows.compactMap { if case .message(let item) = $0 { return item } else { return nil } }
    }

    func testLoadsLatestConversation() async throws {
        let fake = FakeChatDataSource()
        fake.latestId = "c1"
        let model = ClayverChatViewModel(dataSource: fake, calendar: calendar)
        model.start()
        XCTAssertEqual(model.loadState, .loading)

        try await waitUntil("messages stream") { fake.stream("c1") != nil }
        fake.stream("c1")?.yield([message("-a", .customer, at: 10), message("-b", .agent, at: 20)])

        try await waitUntil("loaded") { model.loadState == .loaded && messageItems(model).count == 2 }
        XCTAssertEqual(model.conversationId, "c1")
        XCTAssertEqual(messageItems(model).map(\.id), ["-a", "-b"])
        if case .day = model.rows.first {} else { XCTFail("Expected a day header first") }
        try await waitUntil("team name") { model.teamName == "Acme" }
        XCTAssertEqual(model.welcomeMessage, "Hi!")
    }

    func testEmptyStateWithoutConversation() async throws {
        let fake = FakeChatDataSource()
        let model = ClayverChatViewModel(dataSource: fake, calendar: calendar)
        model.start()
        try await waitUntil("loaded") { model.loadState == .loaded }
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertNil(model.conversationId)
        XCTAssertTrue(fake.messageStreams.isEmpty)
    }

    func testFailureThenRetry() async throws {
        let fake = FakeChatDataSource()
        fake.setLatest(id: nil, error: ClayverError.network)
        let model = ClayverChatViewModel(dataSource: fake, calendar: calendar)
        model.start()
        try await waitUntil("failed") { if case .failed = model.loadState { return true } else { return false } }
        XCTAssertEqual(model.loadState, .failed(ClayverError.network.localizedDescription))

        fake.setLatest(id: "c1", error: nil)
        model.retry()
        try await waitUntil("stream") { fake.stream("c1") != nil }
        fake.stream("c1")?.yield([message("-a", .agent, at: 10)])
        try await waitUntil("loaded") { model.loadState == .loaded }
    }

    func testStreamErrorAfterLoadShowsBanner() async throws {
        let fake = FakeChatDataSource()
        fake.latestId = "c1"
        let model = ClayverChatViewModel(dataSource: fake, calendar: calendar)
        model.start()
        try await waitUntil("stream") { fake.stream("c1") != nil }
        fake.stream("c1")?.yield([message("-a", .agent, at: 10)])
        try await waitUntil("loaded") { model.loadState == .loaded }
        fake.stream("c1")?.finish(throwing: ClayverError.permissionDenied)
        try await waitUntil("banner") { model.connectionError != nil }
        XCTAssertEqual(model.loadState, .loaded)
        XCTAssertEqual(messageItems(model).count, 1)
    }

    func testSendCreatesConversationAndReconcilesWithLiveMessage() async throws {
        let fake = FakeChatDataSource()
        let model = ClayverChatViewModel(dataSource: fake, calendar: calendar)
        model.start()
        try await waitUntil("loaded") { model.loadState == .loaded }

        model.draft = "  Hello  "
        model.sendDraft()
        XCTAssertEqual(model.draft, "")
        XCTAssertEqual(messageItems(model).first?.delivery, .sending)
        XCTAssertEqual(messageItems(model).first?.message.text, "Hello")

        try await waitUntil("sent") { fake.sentCount == 1 && model.conversationId == "c-new" }
        XCTAssertNil(fake.sent.first?.conversationId)
        try await waitUntil("listening to new conversation") { fake.stream("c-new") != nil }
        XCTAssertEqual(messageItems(model).map(\.delivery), [.sent])

        // The live listener delivers the same message; it must not be duplicated.
        let clientId = fake.sent[0].clientMessageId
        fake.stream("c-new")?.yield([message("-sent1", .customer, at: 1_000, text: "Hello", clientMessageId: clientId)])
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(messageItems(model).count, 1)
        // A brand-new conversation never shows the "New messages" divider.
        fake.stream("c-new")?.yield([message("-sent1", .customer, at: 1_000, text: "Hello", clientMessageId: clientId), message("-w", .system, at: 1_001)])
        try await waitUntil("welcome") { messageItems(model).count == 2 }
        XCTAssertFalse(model.rows.contains(.newMessagesDivider))
    }

    func testSecondSendUsesCreatedConversation() async throws {
        let fake = FakeChatDataSource()
        let model = ClayverChatViewModel(dataSource: fake, calendar: calendar)
        model.start()
        try await waitUntil("loaded") { model.loadState == .loaded }
        model.draft = "one"
        model.sendDraft()
        model.draft = "two"
        model.sendDraft()
        try await waitUntil("both sent") { fake.sentCount == 2 }
        XCTAssertNil(fake.sent[0].conversationId)
        XCTAssertEqual(fake.sent[1].conversationId, "c-new")
        XCTAssertEqual(fake.sent.map { $0.text }, ["one", "two"])
    }

    func testFailedSendCanBeRetriedOrDiscarded() async throws {
        let fake = FakeChatDataSource()
        fake.latestId = "c1"
        fake.setSendError(ClayverError.network)
        let model = ClayverChatViewModel(dataSource: fake, calendar: calendar)
        model.start()
        try await waitUntil("stream") { fake.stream("c1") != nil }
        fake.stream("c1")?.yield([])
        try await waitUntil("loaded") { model.loadState == .loaded }

        model.draft = "retry me"
        model.sendDraft()
        try await waitUntil("failed") { if case .failed = messageItems(model).first?.delivery { return true } else { return false } }
        let failedId = try XCTUnwrap(messageItems(model).first?.id)

        fake.setSendError(nil)
        model.retrySend(id: failedId)
        try await waitUntil("sent") { messageItems(model).first?.delivery == .sent }
        XCTAssertEqual(fake.sent.first?.conversationId, "c1")

        fake.setSendError(ClayverError.network)
        model.draft = "drop me"
        model.sendDraft()
        try await waitUntil("failed again") { messageItems(model).contains { if case .failed = $0.delivery { return true } else { return false } } }
        let dropId = try XCTUnwrap(messageItems(model).last?.id)
        model.discardFailed(id: dropId)
        XCTAssertEqual(messageItems(model).count, 1)
    }

    func testRejectsInvalidAttachmentBeforeSending() async throws {
        let fake = FakeChatDataSource()
        let model = ClayverChatViewModel(dataSource: fake, calendar: calendar)
        model.send(attachment: ClayverAttachmentInput(data: Data([0]), fileName: "movie.mp4", contentType: "video/mp4"))
        XCTAssertNotNil(model.alertMessage)
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertEqual(fake.sentCount, 0)
    }

    func testLoadOlderMessages() async throws {
        let fake = FakeChatDataSource()
        fake.latestId = "c1"
        fake.olderPage = [message("-0", .agent, at: 5)]
        let model = ClayverChatViewModel(dataSource: fake, pageSize: 2, calendar: calendar)
        model.start()
        try await waitUntil("stream") { fake.stream("c1") != nil }
        fake.stream("c1")?.yield([message("-a", .customer, at: 10), message("-b", .agent, at: 20)])
        try await waitUntil("loaded") { model.loadState == .loaded }
        XCTAssertTrue(model.hasOlderMessages)

        await model.loadOlder()
        XCTAssertEqual(fake.olderRequests, ["-a"])
        XCTAssertEqual(messageItems(model).map(\.id), ["-0", "-a", "-b"])
        XCTAssertFalse(model.hasOlderMessages, "A short page means the start of history was reached")
    }

    func testNewMessagesDividerAndMarkRead() async throws {
        let fake = FakeChatDataSource()
        fake.latestId = "c1"
        fake.customerReadAt = Date(timeIntervalSince1970: 100)
        let model = ClayverChatViewModel(dataSource: fake, calendar: calendar)
        model.setVisible(true)
        model.start()
        try await waitUntil("stream") { fake.stream("c1") != nil }
        fake.stream("c1")?.yield([
            message("-a", .customer, at: 50),
            message("-b", .agent, at: 80),
            message("-c", .agent, at: 120),
            message("-d", .agent, at: 130),
        ])
        try await waitUntil("loaded") { model.loadState == .loaded }

        let ids = model.rows.map(\.id)
        let dividerIndex = try XCTUnwrap(ids.firstIndex(of: ClayverChatRow.newMessagesDivider.id))
        XCTAssertEqual(ids[dividerIndex + 1], "-c")

        try await waitUntil("marked read") { fake.markReadCount == 1 }
        XCTAssertEqual(fake.markReadCalls, ["c1"])

        // Same snapshot again: no extra write. A new incoming message: one more.
        fake.stream("c1")?.yield([message("-d", .agent, at: 130)])
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(fake.markReadCount, 1)
        fake.stream("c1")?.yield([message("-e", .agent, at: 140)])
        try await waitUntil("marked read again") { fake.markReadCount == 2 }
    }

    func testDoesNotMarkReadWhenHidden() async throws {
        let fake = FakeChatDataSource()
        fake.latestId = "c1"
        let model = ClayverChatViewModel(dataSource: fake, calendar: calendar)
        model.start()
        try await waitUntil("stream") { fake.stream("c1") != nil }
        fake.stream("c1")?.yield([message("-a", .agent, at: 10)])
        try await waitUntil("loaded") { model.loadState == .loaded }
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(fake.markReadCount, 0)
        model.setVisible(true)
        try await waitUntil("marked") { fake.markReadCount == 1 }
    }

    func testSeenReceiptFromAgentReadMarker() async throws {
        let fake = FakeChatDataSource()
        fake.latestId = "c1"
        let model = ClayverChatViewModel(dataSource: fake, calendar: calendar)
        model.start()
        try await waitUntil("streams") { fake.stream("c1") != nil && fake.readStream("c1") != nil }
        fake.stream("c1")?.yield([message("-a", .customer, at: 100), message("-b", .customer, at: 200)])
        fake.readStream("c1")?.yield(Date(timeIntervalSince1970: 150))
        try await waitUntil("seen") { messageItems(model).first(where: \.isSeen)?.id == "-a" }
        fake.readStream("c1")?.yield(Date(timeIntervalSince1970: 250))
        try await waitUntil("seen moves") { messageItems(model).filter(\.isSeen).map(\.id) == ["-b"] }
    }

    func testBuildRowsDayHeadersAndPendingOrder() {
        let day1 = 1_700_000_000.0 // 2023-11-14 UTC
        let rows = ClayverChatViewModel.buildRows(
            confirmed: [message("-b", .agent, at: day1 + 86_400), message("-a", .customer, at: day1)],
            pending: [.init(clientMessageId: "x", text: "pending", attachment: nil, createdAt: Date(timeIntervalSince1970: day1 + 86_401), failure: nil)],
            dividerBeforeId: "-b",
            agentLastReadAt: nil,
            calendar: calendar
        )
        XCTAssertEqual(rows.map(\.id), [
            "day-\(Int(calendar.startOfDay(for: Date(timeIntervalSince1970: day1)).timeIntervalSince1970))",
            "-a",
            "day-\(Int(calendar.startOfDay(for: Date(timeIntervalSince1970: day1 + 86_400)).timeIntervalSince1970))",
            ClayverChatRow.newMessagesDivider.id,
            "-b",
            "local-x",
        ])
    }
}
