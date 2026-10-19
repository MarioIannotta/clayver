import XCTest
@testable import ClayverSDK

@MainActor
final class AgentParsingTests: XCTestCase {
    private func conversation(
        _ id: String,
        customer: String = "cid",
        status: ClayverConversationStatus = .open,
        updatedAt: TimeInterval?,
        lastText: String? = "hello",
        lastSender: ClayverMessage.SenderType = .customer,
        unread: Int = 0,
        assignee: String? = nil
    ) -> ClayverAgentConversation {
        ClayverAgentConversation(
            id: id,
            customerId: customer,
            status: status,
            createdAt: Date(timeIntervalSince1970: 1),
            updatedAt: updatedAt.map(Date.init(timeIntervalSince1970:)),
            lastMessage: lastText.map { ClayverConversation.LastMessage(text: $0, senderType: lastSender, createdAt: nil, hasAttachment: false) },
            unreadForAgents: unread,
            assigneeUid: assignee
        )
    }

    func testParsesConversationRecord() throws {
        let value: [String: Any] = [
            "customerId": "v_abc",
            "status": "open",
            "createdAt": NSNumber(value: 1_000),
            "updatedAt": NSNumber(value: 5_000),
            "assigneeUid": "agent1",
            "statusOrder": "open_000000000005000",
            "unread": ["customer": NSNumber(value: 1), "agent": NSNumber(value: 3)],
            "lastMessage": ["text": "Help", "senderType": "customer", "createdAt": NSNumber(value: 5_000), "hasAttachment": NSNumber(value: false)],
        ]
        let parsed = try XCTUnwrap(ClayverParsing.agentConversation(id: "-C1", value: value))
        XCTAssertEqual(parsed.customerId, "v_abc")
        XCTAssertEqual(parsed.status, .open)
        XCTAssertEqual(parsed.unreadForAgents, 3)
        XCTAssertEqual(parsed.assigneeUid, "agent1")
        XCTAssertEqual(parsed.updatedAt, Date(timeIntervalSince1970: 5))
        XCTAssertEqual(parsed.lastMessage?.text, "Help")
        XCTAssertEqual(parsed.lastMessage?.senderType, .customer)
    }

    func testRejectsConversationWithoutCustomer() {
        XCTAssertNil(ClayverParsing.agentConversation(id: "-C", value: ["status": "open"]))
        XCTAssertNil(ClayverParsing.agentConversation(id: "-C", value: "junk"))
        let minimal = ClayverParsing.agentConversation(id: "-C", value: ["customerId": "c", "assigneeUid": ""])
        XCTAssertNil(minimal?.assigneeUid)
        XCTAssertEqual(minimal?.unreadForAgents, 0)
        XCTAssertEqual(minimal?.status, .unknown)
    }

    func testConversationQueryResultSortedNewestFirst() {
        let children: [(key: String, value: Any?)] = [
            ("-a", ["customerId": "c1", "status": "open", "updatedAt": NSNumber(value: 1_000)]),
            ("-b", ["customerId": "c2", "status": "open", "updatedAt": NSNumber(value: 3_000)]),
            ("-bad", ["status": "open"]),
            ("-c", ["customerId": "c3", "status": "open", "updatedAt": NSNumber(value: 2_000)]),
        ]
        XCTAssertEqual(ClayverParsing.agentConversations(children: children).map(\.id), ["-b", "-c", "-a"])
    }

    func testCustomerProfileParsing() {
        let value: [String: Any] = [
            "account": ["anonymous": NSNumber(value: false), "email": "ada@example.com", "emailVerified": NSNumber(value: true), "displayName": ""],
            "lastSeenAt": NSNumber(value: 9_000),
            "properties": [
                "name": "Ada",
                "plan": "pro",
                "seats": NSNumber(value: 3),
                "ratio": NSNumber(value: 0.5),
                "beta": NSNumber(value: true),
                "junk": ["nested": "x"],
            ],
        ]
        let profile = ClayverParsing.customerProfile(customerId: "uid_abc", value: value)
        XCTAssertEqual(profile.account, ClayverCustomerAccount(anonymous: false, email: "ada@example.com", emailVerified: true, displayName: nil))
        XCTAssertEqual(profile.email, "ada@example.com")
        XCTAssertEqual(profile.lastSeenAt, Date(timeIntervalSince1970: 9))
        XCTAssertEqual(profile.properties["name"], .string("Ada"))
        XCTAssertEqual(profile.properties["seats"], .int(3))
        XCTAssertEqual(profile.properties["ratio"], .double(0.5))
        XCTAssertEqual(profile.properties["beta"], .bool(true))
        XCTAssertNil(profile.properties["junk"])
        XCTAssertEqual(profile.displayName, "Ada")

        let empty = ClayverParsing.customerProfile(customerId: "abc", value: nil)
        XCTAssertTrue(empty.properties.isEmpty)
        XCTAssertNil(empty.account)
        XCTAssertNil(ClayverParsing.customerProfile(customerId: "abc", value: ["account": ["email": "x@y.z"]]).account)
    }

    func testCustomerDisplayNameFallbacks() {
        let account = ClayverCustomerAccount(anonymous: false, email: "user-1@example.com", emailVerified: true, displayName: nil)
        let named = ClayverCustomerProfile(customerId: "0123456789", account: account, properties: [Clayver.UserProperty.name: "  Grace  "], lastSeenAt: nil)
        XCTAssertEqual(named.displayName, "Grace")
        let blankName = ClayverCustomerProfile(customerId: "0123456789", account: account, properties: [Clayver.UserProperty.name: " "], lastSeenAt: nil)
        XCTAssertEqual(blankName.displayName, "user-1@example.com")
        let withAccountName = ClayverCustomerProfile(
            customerId: "0123456789",
            account: ClayverCustomerAccount(anonymous: false, email: "g@example.com", emailVerified: false, displayName: "Grace H"),
            properties: [:],
            lastSeenAt: nil
        )
        XCTAssertEqual(withAccountName.displayName, "Grace H")
        let numericName = ClayverCustomerProfile(customerId: "0123456789", account: nil, properties: [Clayver.UserProperty.name: 5], lastSeenAt: nil)
        XCTAssertEqual(numericName.displayName, "01234567")
        XCTAssertEqual(ClayverCustomerProfile.displayName(customerId: "AbCdEfGhIjKl", profile: nil), "AbCdEfGh")
        XCTAssertEqual(ClayverCustomerProfile.displayName(customerId: "", profile: nil), "Customer")
    }

    func testInboxRowMapping() {
        let profiles = ["c1": ClayverCustomerProfile(customerId: "c1", account: nil, properties: [Clayver.UserProperty.name: "Ada"], lastSeenAt: nil)]
        let rows = ClayverAgentInboxViewModel.buildRows(
            conversations: [
                conversation("-old", customer: "c1", updatedAt: 100, unread: 2, assignee: "me"),
                conversation("-new", customer: "c2xxxxxxxxxx", updatedAt: 300, lastText: "Line one\n  line two ", lastSender: .agent, assignee: "other"),
                conversation("-mid", customer: "c3", updatedAt: 200, lastText: nil),
            ],
            profiles: profiles,
            agentUid: "me"
        )
        XCTAssertEqual(rows.map(\.id), ["-new", "-mid", "-old"])

        let new = rows[0]
        XCTAssertEqual(new.customerName, "c2xxxxxx")
        XCTAssertEqual(new.preview, "Line one line two")
        XCTAssertFalse(new.lastMessageFromCustomer)
        XCTAssertTrue(new.isAssigned)
        XCTAssertFalse(new.isAssignedToMe)

        let mid = rows[1]
        XCTAssertEqual(mid.preview, "No messages yet")
        XCTAssertFalse(mid.hasMessages)
        XCTAssertFalse(mid.isAssigned)

        let old = rows[2]
        XCTAssertEqual(old.customerName, "Ada")
        XCTAssertEqual(old.unreadCount, 2)
        XCTAssertTrue(old.isAssignedToMe)
        XCTAssertTrue(old.lastMessageFromCustomer)
        XCTAssertEqual(old.lastActivityAt, Date(timeIntervalSince1970: 100))
    }

    func testAttachmentPreviewAndTies() {
        XCTAssertEqual(
            ClayverAgentInboxViewModel.preview(ClayverConversation.LastMessage(text: nil, senderType: .customer, createdAt: nil, hasAttachment: true)),
            "Attachment"
        )
        let rows = ClayverAgentInboxViewModel.buildRows(
            conversations: [conversation("-a", updatedAt: 100), conversation("-b", updatedAt: 100)],
            profiles: [:],
            agentUid: nil
        )
        XCTAssertEqual(rows.map(\.id), ["-b", "-a"])
        XCTAssertFalse(rows[0].isAssignedToMe)
    }

    func testSenderNameTruncation() {
        XCTAssertEqual(ClayverValidation.truncatedUTF16("abc", limit: 80), "abc")
        XCTAssertEqual(ClayverValidation.truncatedUTF16(String(repeating: "a", count: 100), limit: 80).count, 80)
        // An emoji is two UTF-16 units and must not be split.
        let truncated = ClayverValidation.truncatedUTF16(String(repeating: "a", count: 79) + "😀", limit: 80)
        XCTAssertEqual(truncated, String(repeating: "a", count: 79))
    }

    func testAgentPaths() {
        let paths = ClayverPaths(projectId: "default")
        XCTAssertEqual(paths.agentDevice("uid1", deviceId: "dev12345"), "clayver/projects/default/devices/agents/uid1/dev12345")
        XCTAssertEqual(paths.agent("uid1"), "clayver/projects/default/agents/uid1")
        XCTAssertEqual(paths.user("cid"), "clayver/projects/default/users/cid")
        XCTAssertEqual(paths.userProperties("cid"), "clayver/projects/default/users/cid/properties")
    }

    func testMessagePerspective() {
        let perspective = ClayverMessagePerspective.agent(myUid: "agent", customerName: "Ada")
        let fromCustomer = message("-a", .customer, at: 1)
        let fromMe = message("-b", .agent, at: 2)
        let fromTeammate = ClayverMessage(id: "-c", conversationId: "c1", senderId: "other", senderType: .agent, senderName: "Sam", text: "x", createdAt: Date())
        let system = message("-d", .system, at: 3)

        XCTAssertFalse(perspective.isOutgoing(fromCustomer))
        XCTAssertTrue(perspective.isOutgoing(fromMe))
        XCTAssertTrue(perspective.isOutgoing(system))
        XCTAssertNil(perspective.senderLabel(for: fromMe))
        XCTAssertEqual(perspective.senderLabel(for: fromTeammate), "Sam")
        XCTAssertEqual(perspective.spokenSender(for: fromCustomer), "Ada")
        XCTAssertEqual(perspective.spokenSender(for: fromMe), "You")

        XCTAssertTrue(ClayverMessagePerspective.customer.isOutgoing(fromCustomer))
        XCTAssertFalse(ClayverMessagePerspective.customer.isOutgoing(fromMe))
        XCTAssertEqual(ClayverMessagePerspective.customer.spokenSender(for: fromCustomer), "You")
    }
}
