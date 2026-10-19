import Foundation

/// An active block on the customer (`moderation/{customerId}`). While it lasts, the database
/// rules reject the customer's new conversations and messages (sends fail with
/// `permissionDenied`); reading the history still works.
public struct ClayverBlockStatus: Equatable, Hashable, Sendable {
    public enum Reason: String, Sendable, CaseIterable {
        case spam
        case abuse
        case rateLimit = "rate_limit"
        case other

        /// The stored value, with unknown values mapped to `.other`.
        public init(storedValue: String?) {
            self = storedValue.flatMap(Reason.init(rawValue:)) ?? .other
        }
    }

    public let reason: Reason
    /// When the block ends; `nil` means until an agent removes it.
    public let until: Date?

    public init(reason: Reason, until: Date?) {
        self.reason = reason
        self.until = until
    }
}

/// The raw `moderation/{customerId}` record, active or not.
struct ClayverModerationRecord: Equatable, Sendable {
    let blocked: Bool
    let reason: ClayverBlockStatus.Reason
    let until: Date?

    /// The block if it is active at `now`: `blocked == true && (until == nil || until > now)`.
    func activeStatus(at now: Date) -> ClayverBlockStatus? {
        guard blocked else { return nil }
        if let until, until <= now { return nil }
        return ClayverBlockStatus(reason: reason, until: until)
    }
}

extension ClayverParsing {
    /// Parses `moderation/{customerId}`. `nil` when there is no record.
    static func moderationRecord(_ value: Any?) -> ClayverModerationRecord? {
        guard let dict = value as? [String: Any] else { return nil }
        return ClayverModerationRecord(
            blocked: bool(dict["blocked"]) ?? false,
            reason: ClayverBlockStatus.Reason(storedValue: string(dict["reason"])),
            until: date(dict["until"])
        )
    }
}

extension ClayverBlockStatus {
    /// Turns live `moderation` records into the active block, re-evaluated when `until` passes:
    /// a block with an end time is followed by `nil` at that time, without a new record.
    static func activeUpdates(
        _ records: AsyncThrowingStream<ClayverModerationRecord?, Error>,
        now: @escaping @Sendable () -> Date = Date.init
    ) -> AsyncThrowingStream<ClayverBlockStatus?, Error> {
        AsyncThrowingStream(ClayverBlockStatus?.self, bufferingPolicy: .bufferingNewest(1)) { continuation in
            let task = Task {
                var expiry: Task<Void, Never>?
                defer { expiry?.cancel() }
                do {
                    for try await record in records {
                        expiry?.cancel()
                        expiry = nil
                        let status = record?.activeStatus(at: now())
                        continuation.yield(status)
                        if let record, status?.until != nil {
                            expiry = Task {
                                await waitForExpiry(of: record, now: now)
                                guard !Task.isCancelled else { return }
                                continuation.yield(nil)
                            }
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: clayverTranslate(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Sleeps until `record` is no longer active (rechecking, in case the clock moved).
    private static func waitForExpiry(of record: ClayverModerationRecord, now: @escaping @Sendable () -> Date) async {
        while let until = record.activeStatus(at: now())?.until {
            let seconds = max(0.01, until.timeIntervalSince(now()))
            do {
                try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            } catch {
                return
            }
        }
    }
}
