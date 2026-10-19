import XCTest
@testable import ClayverSDK

final class NotificationPayloadTests: XCTestCase {
    private let fcmUserInfo: [AnyHashable: Any] = [
        "aps": ["alert": ["title": "Support", "body": "Hi there"]],
        "gcm.message_id": "123",
        "clayver": "1",
        "type": "message",
        "projectId": "default",
        "conversationId": "-NxConv",
        "messageId": "-NyMsg",
        "link": "clayver://conversation/-NxConv",
    ]

    func testParsesFullPayload() throws {
        let payload = try XCTUnwrap(ClayverNotificationPayload(userInfo: fcmUserInfo))
        XCTAssertEqual(payload.type, "message")
        XCTAssertEqual(payload.projectId, "default")
        XCTAssertEqual(payload.conversationId, "-NxConv")
        XCTAssertEqual(payload.messageId, "-NyMsg")
        XCTAssertEqual(payload.link, URL(string: "clayver://conversation/-NxConv"))
        XCTAssertTrue(ClayverNotificationPayload.isClayver(fcmUserInfo))
        XCTAssertTrue(Clayver.isClayverNotification(userInfo: fcmUserInfo))
    }

    func testRejectsNonClayverPush() {
        let other: [AnyHashable: Any] = ["aps": ["alert": "x"], "conversationId": "c"]
        XCTAssertNil(ClayverNotificationPayload(userInfo: other))
        XCTAssertFalse(Clayver.isClayverNotification(userInfo: other))
        XCTAssertFalse(Clayver.isClayverNotification(userInfo: ["clayver": "0"]))
    }

    func testFallsBackToLinkForConversationId() throws {
        let payload = try XCTUnwrap(ClayverNotificationPayload(userInfo: ["clayver": "1", "link": "clayver://conversation/-Abc"]))
        XCTAssertEqual(payload.conversationId, "-Abc")
        XCTAssertEqual(payload.type, "message")
    }

    func testAcceptsNumericMarkerAndNestedData() throws {
        XCTAssertTrue(ClayverNotificationPayload.isClayver(["clayver": NSNumber(value: 1)]))
        let nested: [AnyHashable: Any] = ["data": ["clayver": "1", "conversationId": "-C"]]
        XCTAssertEqual(ClayverNotificationPayload(userInfo: nested)?.conversationId, "-C")
    }

    func testMissingConversationIsNil() {
        XCTAssertNil(ClayverNotificationPayload(userInfo: ["clayver": "1", "type": "message"]))
        XCTAssertNil(ClayverNotificationPayload(userInfo: ["clayver": "1", "conversationId": "bad/id"]))
    }

    func testLinkParsing() {
        XCTAssertEqual(ClayverNotificationPayload.conversationId(fromLink: URL(string: "clayver://conversation/-X")!), "-X")
        XCTAssertNil(ClayverNotificationPayload.conversationId(fromLink: URL(string: "https://example.com/conversation/-X")!))
        XCTAssertNil(ClayverNotificationPayload.conversationId(fromLink: URL(string: "clayver://conversation/")!))
    }

    // MARK: - Audience routing

    func testAudienceDefaultsToCustomer() throws {
        let payload = try XCTUnwrap(ClayverNotificationPayload(userInfo: fcmUserInfo))
        XCTAssertEqual(payload.audience, .customer)
        XCTAssertEqual(ClayverNotificationRoute.route(for: payload, configuredProjectId: "default"), .customerChat(conversationId: "-NxConv"))
    }

    func testAgentAudienceOpensAgentConversation() throws {
        var userInfo = fcmUserInfo
        userInfo["audience"] = "agent"
        let payload = try XCTUnwrap(ClayverNotificationPayload(userInfo: userInfo))
        XCTAssertEqual(payload.audience, .agent)
        XCTAssertEqual(ClayverNotificationRoute.route(for: payload, configuredProjectId: "default"), .agentConversation(conversationId: "-NxConv"))
        // Before configure finishes there is no workspace to compare with yet.
        XCTAssertEqual(ClayverNotificationRoute.route(for: payload, configuredProjectId: nil), .agentConversation(conversationId: "-NxConv"))
    }

    func testExplicitAndUnknownAudiences() throws {
        let customer = try XCTUnwrap(ClayverNotificationPayload(userInfo: ["clayver": "1", "conversationId": "-C", "audience": "customer"]))
        XCTAssertEqual(customer.audience, .customer)
        let upper = try XCTUnwrap(ClayverNotificationPayload(userInfo: ["data": ["clayver": "1", "conversationId": "-C", "audience": "AGENT"]]))
        XCTAssertEqual(upper.audience, .agent)
        let unknown = try XCTUnwrap(ClayverNotificationPayload(userInfo: ["clayver": "1", "conversationId": "-C", "audience": "robot"]))
        XCTAssertEqual(unknown.audience, .customer, "Unknown audiences keep the customer behaviour")
    }

    func testPushForAnotherWorkspaceIsIgnored() throws {
        var userInfo = fcmUserInfo
        userInfo["audience"] = "agent"
        userInfo["projectId"] = "other"
        let payload = try XCTUnwrap(ClayverNotificationPayload(userInfo: userInfo))
        XCTAssertEqual(ClayverNotificationRoute.route(for: payload, configuredProjectId: "default"), .ignore)
        let noProject = ClayverNotificationPayload(type: "message", projectId: nil, conversationId: "-C", messageId: nil, link: nil, audience: .agent)
        XCTAssertEqual(ClayverNotificationRoute.route(for: noProject, configuredProjectId: "default"), .agentConversation(conversationId: "-C"))
    }
}
