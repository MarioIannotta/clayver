import XCTest
@testable import ClayverSDK

private func conversation(
    _ id: String,
    status: ClayverConversation.Status = .open,
    updatedAt: TimeInterval? = nil,
    createdAt: TimeInterval? = 1,
    lastText: String? = "hello",
    lastSender: ClayverMessage.SenderType = .agent,
    lastAt: TimeInterval? = nil,
    attachment: Bool = false,
    unread: Int = 0
) -> ClayverConversation {
    let last: ClayverConversation.LastMessage? = (lastText != nil || attachment)
        ? .init(text: lastText, senderType: lastSender, createdAt: lastAt.map(Date.init(timeIntervalSince1970:)), hasAttachment: attachment)
        : nil
    return ClayverConversation(
        id: id,
        status: status,
        createdAt: createdAt.map(Date.init(timeIntervalSince1970:)),
        updatedAt: updatedAt.map(Date.init(timeIntervalSince1970:)),
        lastMessage: last,
        unreadCount: unread
    )
}

final class ConversationListLayoutTests: XCTestCase {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()
    private let locale = Locale(identifier: "en_US")

    func testSortsNewestActivityFirst() {
        let sorted = ClayverConversationListLayout.sorted([
            conversation("-a", updatedAt: 100),
            conversation("-b", updatedAt: nil, lastAt: 300),
            conversation("-c", updatedAt: nil, createdAt: 200, lastText: nil),
            conversation("-d", updatedAt: 100),
            conversation("-e", updatedAt: nil, createdAt: nil, lastText: nil),
        ])
        XCTAssertEqual(sorted.map(\.id), ["-b", "-c", "-d", "-a", "-e"])
    }

    func testRowFormatting() {
        let rows = ClayverConversationListLayout.rows([
            conversation("-a", status: .closed, updatedAt: 300, lastText: "Thanks!\n\n  See you ", lastSender: .customer),
            conversation("-b", updatedAt: 200, lastText: nil, attachment: true, unread: 2),
            conversation("-c", updatedAt: 100, lastText: nil),
            conversation("-d", updatedAt: 50, unread: -1),
        ])
        XCTAssertEqual(rows.map(\.id), ["-a", "-b", "-c", "-d"])

        XCTAssertEqual(rows[0].preview, "Thanks! See you")
        XCTAssertTrue(rows[0].isResolved)
        XCTAssertTrue(rows[0].lastMessageFromCustomer)
        XCTAssertEqual(rows[0].lastActivityAt, Date(timeIntervalSince1970: 300))

        XCTAssertEqual(rows[1].preview, "Attachment")
        XCTAssertEqual(rows[1].unreadCount, 2)
        XCTAssertFalse(rows[1].isResolved)
        XCTAssertFalse(rows[1].lastMessageFromCustomer)

        XCTAssertEqual(rows[2].preview, "No messages yet")
        XCTAssertFalse(rows[2].hasMessages)

        XCTAssertEqual(rows[3].unreadCount, 0)
    }

    func testTimeLabels() {
        // Wednesday 2024-05-15 14:05 UTC.
        let now = Date(timeIntervalSince1970: 1_715_781_900)
        let label = { (date: Date) in
            ClayverConversationListLayout.timeLabel(for: date, now: now, calendar: self.calendar, locale: self.locale)
        }
        XCTAssertTrue(label(now.addingTimeInterval(-60)).contains("2:04"), label(now.addingTimeInterval(-60)))
        XCTAssertEqual(label(now.addingTimeInterval(-86_400)), "Yesterday")
        XCTAssertEqual(label(now.addingTimeInterval(-3 * 86_400)), "Sunday")
        XCTAssertEqual(label(now.addingTimeInterval(-10 * 86_400)), "May 5")
        XCTAssertEqual(label(now.addingTimeInterval(-400 * 86_400)), "4/11/23")
    }
}

@MainActor
final class ConversationListViewModelTests: XCTestCase {
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

    func testListsConversations() async throws {
        let fake = FakeChatDataSource()
        let model = ClayverConversationListViewModel(dataSource: fake)
        model.start()
        XCTAssertEqual(model.loadState, .loading)
        try await waitUntil("list stream") { fake.listStream != nil }
        fake.listStream?.yield([conversation("-old", updatedAt: 10), conversation("-new", status: .closed, updatedAt: 20)])
        try await waitUntil("loaded") { model.loadState == .loaded }
        XCTAssertEqual(model.rows.map(\.id), ["-new", "-old"])
        XCTAssertTrue(model.rows[0].isResolved)
        try await waitUntil("team name") { model.teamName == "Acme" }
    }

    func testListFailure() async throws {
        let fake = FakeChatDataSource()
        let model = ClayverConversationListViewModel(dataSource: fake)
        model.start()
        try await waitUntil("list stream") { fake.listStream != nil }
        fake.listStream?.finish(throwing: ClayverError.network)
        try await waitUntil("failed") { model.loadState == .failed(ClayverError.network.localizedDescription) }
    }

    func testNewConversationDoesNotLoadLatestAndStartsAConversation() async throws {
        let fake = FakeChatDataSource()
        fake.latestId = "c1"
        let model = ClayverChatViewModel(dataSource: fake, startsNewConversation: true)
        model.start()
        try await waitUntil("loaded") { model.loadState == .loaded }
        XCTAssertNil(model.conversationId)
        XCTAssertNil(fake.stream("c1"))

        model.draft = "one"
        model.sendDraft()
        model.draft = "two"
        model.sendDraft()
        try await waitUntil("sent") { fake.startedCount == 1 && fake.sentCount == 1 }
        XCTAssertEqual(model.conversationId, "c-started1")
        XCTAssertEqual(fake.started.first?.text, "one")
        // The second message goes to the conversation the first one created.
        XCTAssertEqual(fake.sent.first?.conversationId, "c-started1")
        XCTAssertEqual(fake.sent.first?.text, "two")
        try await waitUntil("listening") { fake.stream("c-started1") != nil }
    }

    func testExistingConversationIgnoresNewConversationFlag() async throws {
        let fake = FakeChatDataSource()
        let model = ClayverChatViewModel(dataSource: fake, conversationId: "c1", startsNewConversation: true)
        XCTAssertFalse(model.startsNewConversation)
        model.start()
        try await waitUntil("stream") { fake.stream("c1") != nil }
    }

    func testBlockStatusIsPublished() async throws {
        let fake = FakeChatDataSource()
        let model = ClayverChatViewModel(dataSource: fake)
        model.start()
        try await waitUntil("block stream") { fake.blockStream != nil }
        XCTAssertFalse(model.isBlocked)
        fake.blockStream?.yield(ClayverBlockStatus(reason: .spam, until: nil))
        try await waitUntil("blocked") { model.isBlocked }
        XCTAssertEqual(model.blockStatus?.reason, .spam)
        fake.blockStream?.yield(nil)
        try await waitUntil("unblocked") { !model.isBlocked }
    }
}
