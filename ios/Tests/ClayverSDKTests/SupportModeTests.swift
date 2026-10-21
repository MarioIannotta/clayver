import XCTest
@testable import ClayverSDK

final class SupportModeTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suite = "ClayverSupportModeTests"

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suite)
        defaults.removePersistentDomain(forName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
        super.tearDown()
    }

    func testDefaultsToCustomer() {
        XCTAssertEqual(ClayverSupportModeStore.mode(uid: "u1", projectId: "p", defaults: defaults), .customer)
        XCTAssertEqual(ClayverSupportModeStore.mode(uid: nil, projectId: "p", defaults: defaults), .customer)
    }

    func testRemembersPerUserAndWorkspace() {
        ClayverSupportModeStore.set(.agent, uid: "u1", projectId: "p", defaults: defaults)
        XCTAssertEqual(ClayverSupportModeStore.mode(uid: "u1", projectId: "p", defaults: defaults), .agent)
        XCTAssertEqual(ClayverSupportModeStore.mode(uid: "u2", projectId: "p", defaults: defaults), .customer)
        XCTAssertEqual(ClayverSupportModeStore.mode(uid: "u1", projectId: "other", defaults: defaults), .customer)

        ClayverSupportModeStore.set(.customer, uid: "u1", projectId: "p", defaults: defaults)
        XCTAssertEqual(ClayverSupportModeStore.mode(uid: "u1", projectId: "p", defaults: defaults), .customer)
    }

    func testIgnoresWritesWithoutUser() {
        ClayverSupportModeStore.set(.agent, uid: nil, projectId: "p", defaults: defaults)
        XCTAssertTrue(defaults.dictionaryRepresentation().keys.filter { $0.hasPrefix("clayver.") }.isEmpty)
    }
}
