import Foundation
#if canImport(UniformTypeIdentifiers)
import UniformTypeIdentifiers
#endif

/// Attachment limits from `firebase/database.schema.md` (Storage layout).
/// Only images are accepted; the SDK re-encodes them as JPEG of at most `maxSize`
/// (see `ClayverImageCompressor`) before upload.
public enum ClayverAttachmentRules {
    /// 300 KB (300 * 1024 bytes).
    public static let maxSize = 300 * 1024
    public static let maxFileNameLength = 200
    public static let allowedContentTypes: Set<String> = [
        "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic",
    ]

    private static let extensionMap: [String: String] = [
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif",
        "webp": "image/webp", "heic": "image/heic",
    ]

    /// Infers a MIME type from a file name extension.
    public static func contentType(forFileName fileName: String) -> String? {
        let ext = (fileName as NSString).pathExtension.lowercased()
        guard !ext.isEmpty else { return nil }
        if let known = extensionMap[ext] { return known }
        #if canImport(UniformTypeIdentifiers)
        if let type = UTType(filenameExtension: ext), let mime = type.preferredMIMEType { return mime }
        #endif
        return nil
    }

    /// Validates size and content type before upload.
    public static func validate(contentType: String, size: Int) throws {
        guard allowedContentTypes.contains(contentType.lowercased()) else {
            throw ClayverError.unsupportedAttachmentType(contentType)
        }
        guard size > 0 else { throw ClayverError.invalidArgument("The attachment is empty.") }
        guard size <= maxSize else { throw ClayverError.attachmentTooLarge(size: size, limit: maxSize) }
    }

    public static func validate(_ input: ClayverAttachmentInput) throws {
        try validate(contentType: input.contentType, size: input.data.count)
    }

    /// What is uploaded for `input`: images are compressed to a JPEG of at most `maxSize`
    /// (`ClayverImageCompressor`), then the result is validated. Non-images are rejected.
    public static func prepared(_ input: ClayverAttachmentInput) throws -> ClayverAttachmentInput {
        guard !input.data.isEmpty else { throw ClayverError.invalidArgument("The attachment is empty.") }
        // Raw image bytes sent with a generic type (e.g. application/octet-stream) still count.
        guard input.isImage || ClayverImageCompressor.pixelSize(of: input.data) != nil else {
            throw ClayverError.unsupportedAttachmentType(input.contentType)
        }
        #if canImport(UIKit)
        let output = try ClayverImageCompressor.compress(input)
        #else
        let output = input
        #endif
        try validate(output)
        return output
    }

    /// Makes a file name safe for a Storage path segment and caps it at 200 characters,
    /// keeping the extension.
    public static func sanitizedFileName(_ name: String) -> String {
        var cleaned = String(name.unicodeScalars.map { scalar -> Character in
            if scalar == "/" || scalar == "\\" || CharacterSet.controlCharacters.contains(scalar)
                || "#[]*?".unicodeScalars.contains(scalar) {
                return "_"
            }
            return Character(scalar)
        }).trimmingCharacters(in: .whitespacesAndNewlines)
        while cleaned.hasPrefix(".") { cleaned.removeFirst() }
        if cleaned.isEmpty { cleaned = "file" }
        guard cleaned.count > maxFileNameLength else { return cleaned }
        let ext = (cleaned as NSString).pathExtension
        let suffix = ext.isEmpty || ext.count > 16 ? "" : "." + ext
        let base = String(cleaned.dropLast(suffix.count).prefix(maxFileNameLength - suffix.count))
        return base + suffix
    }
}

/// Validation of client-written fields, mirroring the security rules so that
/// mistakes surface as `invalidArgument` instead of an opaque `permissionDenied`.
enum ClayverValidation {
    static let maxTextLength = 4000
    static let maxPropertyStringLength = 1000
    static let maxPushTokenLength = 4096
    /// `messages/.../senderName` is 1..80 characters (UTF-16 code units, as in the rules).
    static let maxSenderNameLength = 80

    /// Cuts `text` to at most `limit` UTF-16 code units without splitting a character.
    static func truncatedUTF16(_ text: String, limit: Int) -> String {
        guard text.utf16.count > limit else { return text }
        var result = ""
        var count = 0
        for character in text {
            let length = String(character).utf16.count
            if count + length > limit { break }
            result.append(character)
            count += length
        }
        return result
    }

    private static let propertyKeyPattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    private static let projectIdPattern = try! NSRegularExpression(pattern: "^[a-z0-9-]{1,40}$")
    private static let deviceIdPattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{8,64}$")

    static func matches(_ regex: NSRegularExpression, _ string: String) -> Bool {
        let range = NSRange(string.startIndex..<string.endIndex, in: string)
        return regex.firstMatch(in: string, range: range) != nil
    }

    /// Custom keys (`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`) or one of `Clayver.UserProperty`.
    static func isValidPropertyKey(_ key: String) -> Bool {
        Clayver.UserProperty.all.contains(key) || matches(propertyKeyPattern, key)
    }
    static func isValidProjectId(_ id: String) -> Bool { matches(projectIdPattern, id) }
    static func isValidDeviceId(_ id: String) -> Bool { matches(deviceIdPattern, id) }

    /// Realtime Database keys cannot contain `.`, `#`, `$`, `[`, `]`, `/` or control characters.
    static func isValidDatabaseKey(_ key: String) -> Bool {
        guard !key.isEmpty, key.utf8.count <= 768 else { return false }
        let forbidden = CharacterSet(charactersIn: ".#$[]/").union(.controlCharacters)
        return key.unicodeScalars.allSatisfy { !forbidden.contains($0) }
    }

    static func validateProperties(_ properties: [String: ClayverValue]) throws {
        for (key, value) in properties {
            guard isValidPropertyKey(key) else {
                throw ClayverError.invalidArgument("Invalid property key \"\(key)\". Use 1-64 characters from A-Z, a-z, 0-9, '_' and '-', not starting with '_' (reserved for Clayver.UserProperty).")
            }
            if Clayver.UserProperty.all.contains(key) {
                guard case .string = value else {
                    throw ClayverError.invalidArgument("Property \"\(key)\" must be a string.")
                }
            }
            switch value {
            case .string(let string):
                // Rules count string length in UTF-16 code units.
                guard string.utf16.count <= maxPropertyStringLength else {
                    throw ClayverError.invalidArgument("Property \"\(key)\" is longer than \(maxPropertyStringLength) characters.")
                }
            case .double(let number):
                guard number.isFinite else {
                    throw ClayverError.invalidArgument("Property \"\(key)\" must be a finite number.")
                }
            case .int, .bool:
                break
            }
        }
    }

    /// Returns the trimmed text, or `nil` when there is none.
    static func normalizedText(_ text: String?) throws -> String? {
        guard let text else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard trimmed.utf16.count <= maxTextLength else {
            throw ClayverError.invalidArgument("Messages are limited to \(maxTextLength) characters.")
        }
        return trimmed
    }

    static func validateConversationId(_ id: String) throws {
        guard isValidDatabaseKey(id) else {
            throw ClayverError.invalidArgument("Invalid conversation id \"\(id)\".")
        }
    }
}
