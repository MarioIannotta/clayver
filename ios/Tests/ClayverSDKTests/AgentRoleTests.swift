import XCTest
@testable import ClayverSDK

final class AgentRoleTests: XCTestCase {
    func testMissingClaimIsCustomer() {
        XCTAssertNil(ClayverAgentRole.fromClaims([:], projectId: "default"))
        XCTAssertNil(ClayverAgentRole.fromClaims(["clayver_cid": "v_abc", "sub": "uid1"], projectId: "default"))
    }

    func testRoleForThisWorkspace() {
        XCTAssertEqual(ClayverAgentRole.fromClaims(["clayver_roles": ["default": "admin"]], projectId: "default"), .admin)
        XCTAssertEqual(ClayverAgentRole.fromClaims(["clayver_roles": ["default": "agent"]], projectId: "default"), .agent)
        XCTAssertTrue(ClayverAgentRole.admin.isAdmin)
        XCTAssertFalse(ClayverAgentRole.agent.isAdmin)
    }

    func testRoleInAnotherWorkspaceOnly() {
        let claims: [String: Any] = ["clayver_roles": ["support-eu": "admin"]]
        XCTAssertNil(ClayverAgentRole.fromClaims(claims, projectId: "default"))
        XCTAssertEqual(ClayverAgentRole.fromClaims(claims, projectId: "support-eu"), .admin)
    }

    func testSeveralWorkspaces() {
        let claims: [String: Any] = ["clayver_roles": ["default": "agent", "vip": "admin"]]
        XCTAssertEqual(ClayverAgentRole.fromClaims(claims, projectId: "default"), .agent)
        XCTAssertEqual(ClayverAgentRole.fromClaims(claims, projectId: "vip"), .admin)
    }

    func testMalformedClaims() {
        XCTAssertNil(ClayverAgentRole.fromClaims(["clayver_roles": "admin"], projectId: "default"))
        XCTAssertNil(ClayverAgentRole.fromClaims(["clayver_roles": ["admin"]], projectId: "default"))
        XCTAssertNil(ClayverAgentRole.fromClaims(["clayver_roles": ["default": true]], projectId: "default"))
        XCTAssertNil(ClayverAgentRole.fromClaims(["clayver_roles": ["default": 1]], projectId: "default"))
        XCTAssertNil(ClayverAgentRole.fromClaims(["clayver_roles": ["default": "owner"]], projectId: "default"))
        XCTAssertNil(ClayverAgentRole.fromClaims(["clayver_roles": ["default": "ADMIN"]], projectId: "default"))
        XCTAssertNil(ClayverAgentRole.fromClaims(["clayver_roles": ["default": ""]], projectId: "default"))
        XCTAssertNil(ClayverAgentRole.fromClaims(["clayver_roles": NSNull()], projectId: "default"))
    }

    func testBridgedDictionaryFromTokenResult() {
        // `IDTokenResult.claims` arrives as bridged Foundation collections.
        let roles: NSDictionary = ["default": NSString(string: "agent")]
        XCTAssertEqual(ClayverAgentRole.fromClaims(["clayver_roles": roles], projectId: "default"), .agent)
    }
}
