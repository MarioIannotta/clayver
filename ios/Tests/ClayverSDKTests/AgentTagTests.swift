import XCTest
@testable import ClayverSDK

@MainActor
final class AgentTagViewModelTests: XCTestCase {
    private let bug = ClayverTag(id: "bug", name: "Bug", color: "#EA580C")
    private let urgent = ClayverTag(id: "urgent", name: "Urgent", color: "#DC2626")

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

    func testInboxFiltersByTag() async throws {
        let fake = FakeAgentDataSource()
        let model = ClayverAgentInboxViewModel(dataSource: fake)
        model.start()
        try await waitUntil("tags stream") { fake.tagStream != nil }
        fake.tagStream?.yield([urgent, bug])
        try await waitUntil("tags") { model.tags.count == 2 }
        XCTAssertEqual(model.tags.map(\.id), ["bug", "urgent"])
        XCTAssertNil(model.selectedTagId)

        try await waitUntil("inbox") { fake.inbox(.open) != nil }
        fake.inbox(.open)?.yield([agentConversation("c1"), agentConversation("c2")])
        try await waitUntil("rows") { model.rows.count == 2 }

        model.select(tagId: "bug")
        XCTAssertEqual(model.selectedTagId, "bug")
        XCTAssertTrue(model.rows.isEmpty)
        try await waitUntil("tagged inbox") { fake.taggedInbox("bug") != nil }
        fake.taggedInbox("bug")?.yield([agentConversation("c2")])
        try await waitUntil("filtered rows") { model.rows.map(\.id) == ["c2"] }

        // Deleting the selected tag goes back to all conversations.
        fake.tagStream?.yield([urgent])
        try await waitUntil("filter cleared") { model.selectedTagId == nil }
    }

    func testConversationTagsToggleAndCreate() async throws {
        let fake = FakeAgentDataSource()
        let model = ClayverAgentConversationViewModel(dataSource: fake, conversationId: "c1")
        model.start()
        try await waitUntil("tag streams") { fake.tagStream != nil && fake.conversationTagStream("c1") != nil }
        fake.tagStream?.yield([bug, urgent])
        fake.conversationTagStream("c1")?.yield(["urgent"])
        try await waitUntil("tags") { model.tags.map(\.id) == ["urgent"] }
        XCTAssertTrue(model.hasTag("urgent"))
        XCTAssertFalse(model.hasTag("bug"))

        await model.toggleTag("bug")
        XCTAssertEqual(model.tagIds, ["bug", "urgent"])
        await model.toggleTag("urgent")
        XCTAssertEqual(model.tagIds, ["bug"])
        XCTAssertEqual(fake.tagCalls.map { $0.added }, [true, false])
        XCTAssertEqual(fake.tagCalls.map { $0.tagId }, ["bug", "urgent"])

        await model.createAndAddTag(named: "Refund request")
        XCTAssertEqual(fake.createdTags.map(\.id), ["refund-request"])
        XCTAssertTrue(model.hasTag("refund-request"))
        XCTAssertEqual(model.tags.map(\.name), ["Bug", "Refund request"])
    }

    func testFailedTagChangeIsReverted() async throws {
        let fake = FakeAgentDataSource()
        let model = ClayverAgentConversationViewModel(dataSource: fake, conversationId: "c1")
        model.start()
        try await waitUntil("tag streams") { fake.conversationTagStream("c1") != nil }
        fake.conversationTagStream("c1")?.yield(["urgent"])
        try await waitUntil("tags") { model.tagIds == ["urgent"] }

        fake.setActionError(ClayverError.permissionDenied)
        await model.setTag("bug", on: true)
        XCTAssertEqual(model.tagIds, ["urgent"])
        XCTAssertNotNil(model.alertMessage)
    }

    func testEffectiveTagIds() {
        XCTAssertEqual(
            ClayverAgentConversationViewModel.effectiveTagIds(server: ["b", "a"], changes: ["c": true, "a": false]),
            ["b", "c"]
        )
    }
}
