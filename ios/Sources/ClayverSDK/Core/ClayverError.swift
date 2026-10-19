import Foundation

/// The single error type thrown by every Clayver API.
///
/// `code` is stable across platforms (see `docs/sdk-api.md`); the Flutter plugin
/// forwards it as a lowerCamelCase string.
///
/// Task cancellation is reported as Swift's `CancellationError`, not as
/// `ClayverError.cancelled`. `.cancelled` is used when Firebase itself reports a
/// cancelled operation that the calling task did not ask for.
public enum ClayverError: Error, Equatable, Sendable {
    case notConfigured
    case notAuthenticated
    case permissionDenied
    case invalidArgument(String)
    case network
    case attachmentTooLarge(size: Int, limit: Int)
    case unsupportedAttachmentType(String)
    case cancelled
    case `internal`(String)

    /// Stable, cross-platform error codes.
    public enum Code: String, Sendable, CaseIterable {
        case notConfigured
        case notAuthenticated
        case permissionDenied
        case invalidArgument
        case network
        case attachmentTooLarge
        case unsupportedAttachmentType
        case cancelled
        case `internal`
    }

    public var code: Code {
        switch self {
        case .notConfigured: return .notConfigured
        case .notAuthenticated: return .notAuthenticated
        case .permissionDenied: return .permissionDenied
        case .invalidArgument: return .invalidArgument
        case .network: return .network
        case .attachmentTooLarge: return .attachmentTooLarge
        case .unsupportedAttachmentType: return .unsupportedAttachmentType
        case .cancelled: return .cancelled
        case .internal: return .internal
        }
    }
}

extension ClayverError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Clayver is not configured. Call Clayver.configure() first."
        case .notAuthenticated:
            return "You are not signed in. Please try again."
        case .permissionDenied:
            return "You don't have permission to do that."
        case .invalidArgument(let message):
            return message
        case .network:
            return "The network connection appears to be offline. Please try again."
        case .attachmentTooLarge(_, let limit):
            let formatter = ByteCountFormatter()
            // Binary, so the 300 * 1024 byte limit reads "300 KB".
            formatter.countStyle = .binary
            return "Attachments must be \(formatter.string(fromByteCount: Int64(limit))) or smaller."
        case .unsupportedAttachmentType(let type):
            return "Only photos can be sent (not \(type))."
        case .cancelled:
            return "The operation was cancelled."
        case .internal(let message):
            return message.isEmpty ? "Something went wrong. Please try again." : message
        }
    }
}

// MARK: - Mapping Firebase errors

extension ClayverError {
    /// Firebase error domains. Kept as strings so the mapping is a pure function
    /// that can be unit-tested without Firebase.
    enum Domain {
        static let auth = "FIRAuthErrorDomain"
        static let functions = "com.firebase.functions"
        static let storage = "FIRStorageErrorDomain"
        /// FirebaseDatabase reports server errors in `kFirebaseCoreErrorDomain`.
        static let database = "com.firebase"
        static let databaseAlt = "firebase.database"
        static let messaging = "com.google.fcm"
    }

    /// Maps any error (typically an `NSError` from a Firebase SDK) to a `ClayverError`.
    public static func from(_ error: Error) -> ClayverError {
        if let clayver = error as? ClayverError { return clayver }
        if error is CancellationError { return .cancelled }
        return from(nsError: error as NSError, depth: 0)
    }

    private static func from(nsError error: NSError, depth: Int) -> ClayverError {
        let mapped: ClayverError?
        switch error.domain {
        case NSURLErrorDomain:
            mapped = error.code == NSURLErrorCancelled ? .cancelled : .network
        case Domain.auth:
            mapped = authError(error)
        case Domain.functions:
            mapped = functionsError(error)
        case Domain.storage:
            mapped = storageError(error)
        case Domain.database, Domain.databaseAlt:
            mapped = databaseError(error)
        default:
            mapped = nil
        }
        if let mapped { return mapped }

        // Fall back to the underlying error, which often carries an NSURLError.
        if depth < 4, let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError {
            let inner = from(nsError: underlying, depth: depth + 1)
            if case .internal = inner {} else { return inner }
        }
        if error.localizedDescription.lowercased().contains("permission denied")
            || error.localizedDescription.lowercased().contains("permission_denied") {
            return .permissionDenied
        }
        return .internal(error.localizedDescription)
    }

    private static func authError(_ error: NSError) -> ClayverError? {
        switch error.code {
        case 17020, // networkError
             17010: // tooManyRequests
            return .network
        case 17005, // userDisabled
             17011, // userNotFound
             17014, // requiresRecentLogin
             17017, // invalidUserToken
             17021, // userTokenExpired
             17023, // invalidAPIKey
             17024: // userMismatch
            return .notAuthenticated
        case 17006: // operationNotAllowed (e.g. anonymous sign-in disabled)
            return .permissionDenied
        default:
            return nil
        }
    }

    /// Callable function errors use gRPC status codes (`FunctionsErrorCode`).
    private static func functionsError(_ error: NSError) -> ClayverError? {
        let message = error.localizedDescription
        switch error.code {
        case 1: return .cancelled
        case 3, 11: return .invalidArgument(message) // invalidArgument, outOfRange
        case 4, 14: return .network // deadlineExceeded, unavailable
        case 5: return .internal("Cloud Function not found. Did you deploy the Clayver functions to this region?")
        case 7: return .permissionDenied
        case 9: return .internal(message) // failedPrecondition
        case 16: return .notAuthenticated
        default: return nil
        }
    }

    private static func storageError(_ error: NSError) -> ClayverError? {
        switch error.code {
        case -13020: return .notAuthenticated // unauthenticated
        case -13021: return .permissionDenied // unauthorized (also returned for rule-rejected size/type)
        case -13030: return .network // retryLimitExceeded
        case -13040: return .cancelled
        case -13050: return .invalidArgument(error.localizedDescription)
        default: return nil
        }
    }

    private static func databaseError(_ error: NSError) -> ClayverError? {
        switch error.code {
        case 1: return .permissionDenied // permission_denied
        case 2: return .network // unavailable
        case 3: return .cancelled // write_canceled
        default: return nil
        }
    }
}

/// Converts an error raised inside an SDK operation into what the public API throws:
/// `CancellationError` if the calling task was cancelled, otherwise a `ClayverError`.
func clayverTranslate(_ error: Error) -> Error {
    if error is CancellationError || Task.isCancelled { return CancellationError() }
    return ClayverError.from(error)
}
