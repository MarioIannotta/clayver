import XCTest
@testable import ClayverSDK

final class BlockStatusTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000)

    func testParsesModerationRecord() throws {
        let value: [String: Any] = [
            "blocked": NSNumber(value: true),
            "reason": "rate_limit",
            "until": NSNumber(value: 2_000_000),
            "by": "system",
            "at": NSNumber(value: 1_000_000),
        ]
        let record = try XCTUnwrap(ClayverParsing.moderationRecord(value))
        XCTAssertTrue(record.blocked)
        XCTAssertEqual(record.reason, .rateLimit)
        XCTAssertEqual(record.until, Date(timeIntervalSince1970: 2_000))
        XCTAssertNil(ClayverParsing.moderationRecord(nil))
        XCTAssertNil(ClayverParsing.moderationRecord(NSNull()))
    }

    func testUnknownReasonMapsToOther() {
        XCTAssertEqual(ClayverBlockStatus.Reason(storedValue: "harassment"), .other)
        XCTAssertEqual(ClayverBlockStatus.Reason(storedValue: nil), .other)
        XCTAssertEqual(ClayverBlockStatus.Reason(storedValue: "spam"), .spam)
        XCTAssertEqual(ClayverBlockStatus.Reason(storedValue: "abuse"), .abuse)
    }

    func testActiveRule() {
        let permanent = ClayverModerationRecord(blocked: true, reason: .abuse, until: nil)
        XCTAssertEqual(permanent.activeStatus(at: now), ClayverBlockStatus(reason: .abuse, until: nil))

        let future = ClayverModerationRecord(blocked: true, reason: .rateLimit, until: now.addingTimeInterval(60))
        XCTAssertEqual(future.activeStatus(at: now)?.until, now.addingTimeInterval(60))

        let expired = ClayverModerationRecord(blocked: true, reason: .rateLimit, until: now)
        XCTAssertNil(expired.activeStatus(at: now))

        let notBlocked = ClayverModerationRecord(blocked: false, reason: .spam, until: nil)
        XCTAssertNil(notBlocked.activeStatus(at: now))
    }

    func testUpdatesEmitNilWhenTheBlockEnds() async throws {
        var input: AsyncThrowingStream<ClayverModerationRecord?, Error>.Continuation!
        let records = AsyncThrowingStream<ClayverModerationRecord?, Error> { input = $0 }
        let until = Date().addingTimeInterval(0.2)
        input.yield(ClayverModerationRecord(blocked: true, reason: .rateLimit, until: until))

        var iterator = ClayverBlockStatus.activeUpdates(records).makeAsyncIterator()
        let first = try await iterator.next()
        XCTAssertEqual(first, .some(ClayverBlockStatus(reason: .rateLimit, until: until)))
        // No new record: the stream re-evaluates when `until` passes.
        let second = try await iterator.next()
        XCTAssertEqual(second, .some(nil))
        XCTAssertGreaterThanOrEqual(Date(), until)
        input.finish()
    }

    func testNewRecordReplacesThePendingExpiry() async throws {
        var input: AsyncThrowingStream<ClayverModerationRecord?, Error>.Continuation!
        let records = AsyncThrowingStream<ClayverModerationRecord?, Error> { input = $0 }
        input.yield(ClayverModerationRecord(blocked: true, reason: .spam, until: Date().addingTimeInterval(5)))

        var iterator = ClayverBlockStatus.activeUpdates(records).makeAsyncIterator()
        _ = try await iterator.next()
        // An agent unblocks (the record is deleted) before the block would have expired.
        input.yield(nil)
        let unblocked = try await iterator.next()
        XCTAssertEqual(unblocked, .some(nil))
        // The cancelled expiry does not emit again.
        input.yield(ClayverModerationRecord(blocked: true, reason: .abuse, until: nil))
        let blocked = try await iterator.next()
        XCTAssertEqual(blocked, .some(ClayverBlockStatus(reason: .abuse, until: nil)))
        input.finish()
        let end = try await iterator.next()
        XCTAssertNil(end)
    }
}
