import XCTest
@testable import ClayverSDK

final class AgentTriageTests: XCTestCase {
    func testTriageOptionIdValidation() {
        XCTAssertTrue(ClayverParsing.isValidTriageOptionId("high"))
        XCTAssertTrue(ClayverParsing.isValidTriageOptionId("in_progress"))
        XCTAssertTrue(ClayverParsing.isValidTriageOptionId("p-1"))
        XCTAssertFalse(ClayverParsing.isValidTriageOptionId(""))
        XCTAssertFalse(ClayverParsing.isValidTriageOptionId("_x"))
        XCTAssertFalse(ClayverParsing.isValidTriageOptionId("High"))
        XCTAssertFalse(ClayverParsing.isValidTriageOptionId(String(repeating: "a", count: 41)))
    }

    func testTriageParsing() {
        XCTAssertEqual(ClayverParsing.triage(nil), ClayverTriage.none)
        XCTAssertEqual(ClayverParsing.triage(["priority": "high", "stage": "todo"] as [String: Any]), ClayverTriage(priority: "high", stage: "todo"))
        XCTAssertEqual(ClayverParsing.triage(["priority": "Bad Id", "stage": NSNumber(value: 3)] as [String: Any]), ClayverTriage.none)
    }

    func testTriageOptionsFallBackToDefaultsPerList() {
        let defaults = ClayverParsing.triageOptions(nil)
        XCTAssertEqual(defaults, .defaults)
        XCTAssertEqual(defaults.priority.map(\.id), ["high", "medium", "low"])
        XCTAssertEqual(defaults.stage.map(\.id), ["todo", "in_progress", "on_hold"])
        XCTAssertEqual(defaults.priority.first?.color, "#DC2626")

        let custom = ClayverParsing.triageOptions([
            "priority": [
                "urgent": ["name": "Urgent", "color": "#FF0000", "order": NSNumber(value: 0)] as [String: Any],
                "later": ["name": "Later", "color": "nope", "order": NSNumber(value: 2)] as [String: Any],
                "mid": ["name": "Mid", "color": "#00FF00", "order": NSNumber(value: 1)] as [String: Any],
                "Bad": ["name": "Bad", "color": "#000000", "order": NSNumber(value: 3)] as [String: Any],
                "noname": ["color": "#000000"] as [String: Any],
            ] as [String: Any],
        ] as [String: Any])
        XCTAssertEqual(custom.priority.map(\.id), ["urgent", "mid", "later"])
        XCTAssertEqual(custom.priority.last?.color, "#64748B")
        XCTAssertEqual(custom.stage, ClayverTriageOption.defaults(for: .stage), "An unsaved list keeps the defaults")
        XCTAssertEqual(custom.option(.priority, id: "mid")?.name, "Mid")
        XCTAssertNil(custom.option(.priority, id: "high"), "Removed options show as unset")
    }

    func testNotesParsingNewestFirst() {
        let notes = ClayverParsing.notes(conversationId: "c1", children: [
            (key: "-a", value: ["authorUid": "u1", "authorName": "Ann", "text": "first", "createdAt": NSNumber(value: 1_000)] as [String: Any]),
            (key: "-b", value: ["authorUid": "u2", "text": "second", "createdAt": NSNumber(value: 2_000)] as [String: Any]),
            (key: "-c", value: ["authorUid": "u2"] as [String: Any]),
        ])
        XCTAssertEqual(notes.map(\.id), ["-b", "-a"])
        XCTAssertEqual(notes.last?.authorName, "Ann")
        XCTAssertNil(notes.first?.authorName)
    }

    func testAgentNames() {
        let names = ClayverParsing.agentNames([
            "u1": ["displayName": "Ann", "email": "ann@example.com"] as [String: Any],
            "u2": ["email": "bob@example.com"] as [String: Any],
            "u3": ["active": true] as [String: Any],
        ] as [String: Any])
        XCTAssertEqual(names, ["u1": "Ann", "u2": "bob"])
    }

    func testTriagePaths() {
        let paths = ClayverPaths(projectId: "default")
        XCTAssertEqual(paths.triage("c1"), "clayver/projects/default/triage/c1")
        XCTAssertEqual(paths.triageOptions, "clayver/projects/default/triageOptions")
        XCTAssertEqual(paths.note("c1", noteId: "-n"), "clayver/projects/default/notes/c1/-n")
    }

    func testBlockDurations() {
        XCTAssertNil(ClayverBlockDuration.permanent.interval)
        XCTAssertEqual(ClayverBlockDuration.oneDay.interval, 86_400)
    }
}
