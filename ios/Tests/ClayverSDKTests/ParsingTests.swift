import XCTest
@testable import ClayverSDK

final class ParsingTests: XCTestCase {
    func testParsesMessageWithAttachment() throws {
        let value: [String: Any] = [
            "senderId": "agent1",
            "senderType": "agent",
            "senderName": "Sam",
            "text": "Hello",
            "createdAt": NSNumber(value: 1_700_000_000_000 as Int64),
            "clientMessageId": "cm1",
            "attachment": [
                "storagePath": "clayver/projects/default/customers/u/conversations/c/a/f.png",
                "fileName": "f.png",
                "contentType": "image/png",
                "size": NSNumber(value: 1234),
                "width": NSNumber(value: 640),
                "height": NSNumber(value: 480),
            ] as [String: Any],
        ]
        let message = try XCTUnwrap(ClayverParsing.message(id: "-m1", conversationId: "c", value: value))
        XCTAssertEqual(message.senderType, .agent)
        XCTAssertEqual(message.senderName, "Sam")
        XCTAssertEqual(message.createdAt, Date(timeIntervalSince1970: 1_700_000_000))
        XCTAssertEqual(message.attachment?.size, 1234)
        XCTAssertEqual(message.attachment?.width, 640)
        XCTAssertTrue(message.attachment?.isImage ?? false)
        XCTAssertEqual(message.clientMessageId, "cm1")
    }

    func testRejectsEmptyMessages() {
        XCTAssertNil(ClayverParsing.message(id: "m", conversationId: "c", value: ["senderType": "agent"]))
        XCTAssertNil(ClayverParsing.message(id: "m", conversationId: "c", value: "garbage"))
    }

    func testMessagesSortedByKey() {
        let children: [(key: String, value: Any?)] = [
            ("-b", ["text": "2", "senderType": "customer", "createdAt": NSNumber(value: 2)]),
            ("-a", ["text": "1", "senderType": "unknownType", "createdAt": NSNumber(value: 1)]),
        ]
        let messages = ClayverParsing.messages(conversationId: "c", children: children)
        XCTAssertEqual(messages.map(\.id), ["-a", "-b"])
        XCTAssertEqual(messages.first?.senderType, .unknown)
    }

    func testConversationsNewestFirstAndPreferredOpen() {
        let value: [String: Any] = [
            "c1": ["status": "closed", "updatedAt": NSNumber(value: 300), "unread": ["customer": NSNumber(value: 0)]],
            "c2": ["status": "open", "updatedAt": NSNumber(value: 200), "unread": ["customer": NSNumber(value: 2)],
                   "lastMessage": ["text": "hey", "senderType": "agent", "createdAt": NSNumber(value: 200), "hasAttachment": false]],
            "c3": ["status": "open", "updatedAt": NSNumber(value: 100)],
        ]
        let conversations = ClayverParsing.conversations(value)
        XCTAssertEqual(conversations.map(\.id), ["c1", "c2", "c3"])
        XCTAssertEqual(conversations[1].unreadCount, 2)
        XCTAssertEqual(conversations[1].lastMessage?.text, "hey")
        XCTAssertEqual(ClayverParsing.preferredConversationId(conversations), "c2")
        XCTAssertEqual(ClayverParsing.openConversationId(conversations), "c2")
        XCTAssertNil(ClayverParsing.openConversationId(Array(conversations.prefix(1))))
        XCTAssertEqual(ClayverParsing.preferredConversationId(Array(conversations.prefix(1))), "c1")
        XCTAssertEqual(ClayverParsing.conversations(nil), [])
    }

    func testScalars() {
        XCTAssertEqual(ClayverParsing.int(NSNumber(value: 7)), 7)
        XCTAssertNil(ClayverParsing.int(nil))
        XCTAssertNil(ClayverParsing.date("x"))
        XCTAssertEqual(ClayverParsing.publicConfig(["teamName": "Acme"])?.teamName, "Acme")
    }
}
