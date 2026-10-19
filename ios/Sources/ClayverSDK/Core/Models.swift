import Foundation

/// A support conversation as seen by the customer (`inbox/{cid}/conversations/{id}`).
public struct ClayverConversation: Identifiable, Equatable, Hashable, Sendable {
    public enum Status: String, Sendable {
        case open
        case closed
        case unknown
    }

    public struct LastMessage: Equatable, Hashable, Sendable {
        public let text: String?
        public let senderType: ClayverMessage.SenderType
        public let createdAt: Date?
        public let hasAttachment: Bool

        public init(text: String?, senderType: ClayverMessage.SenderType, createdAt: Date?, hasAttachment: Bool) {
            self.text = text
            self.senderType = senderType
            self.createdAt = createdAt
            self.hasAttachment = hasAttachment
        }
    }

    public let id: String
    public let status: Status
    public let createdAt: Date?
    public let updatedAt: Date?
    public let lastMessage: LastMessage?
    /// Messages from the support team the customer has not read yet.
    public let unreadCount: Int

    public init(id: String, status: Status, createdAt: Date?, updatedAt: Date?, lastMessage: LastMessage?, unreadCount: Int) {
        self.id = id
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.lastMessage = lastMessage
        self.unreadCount = unreadCount
    }
}

/// A message in `messages/{conversationId}/{messageId}`.
public struct ClayverMessage: Identifiable, Equatable, Hashable, Sendable {
    public enum SenderType: String, Sendable {
        case customer
        case agent
        case system
        case unknown
    }

    public let id: String
    public let conversationId: String
    public let senderId: String
    public let senderType: SenderType
    /// Display name of the agent, when the sender is an agent.
    public let senderName: String?
    public let text: String?
    public let attachment: ClayverAttachment?
    public let createdAt: Date
    public let clientMessageId: String?

    public init(
        id: String,
        conversationId: String,
        senderId: String,
        senderType: SenderType,
        senderName: String? = nil,
        text: String?,
        attachment: ClayverAttachment? = nil,
        createdAt: Date,
        clientMessageId: String? = nil
    ) {
        self.id = id
        self.conversationId = conversationId
        self.senderId = senderId
        self.senderType = senderType
        self.senderName = senderName
        self.text = text
        self.attachment = attachment
        self.createdAt = createdAt
        self.clientMessageId = clientMessageId
    }

    public var isFromCustomer: Bool { senderType == .customer }
}

/// Attachment metadata stored on a message. The bytes live in Cloud Storage at `storagePath`.
public struct ClayverAttachment: Equatable, Hashable, Sendable {
    public let storagePath: String
    public let fileName: String
    public let contentType: String
    public let size: Int
    public let width: Int?
    public let height: Int?

    public init(storagePath: String, fileName: String, contentType: String, size: Int, width: Int? = nil, height: Int? = nil) {
        self.storagePath = storagePath
        self.fileName = fileName
        self.contentType = contentType
        self.size = size
        self.width = width
        self.height = height
    }

    public var isImage: Bool { contentType.hasPrefix("image/") }
}

/// A file to send with `Clayver.sendMessage(text:conversationId:attachment:)`.
public struct ClayverAttachmentInput: Equatable, Sendable {
    public let data: Data
    public let fileName: String
    public let contentType: String
    public let width: Int?
    public let height: Int?

    /// - Parameters:
    ///   - contentType: MIME type. Only images are accepted; before upload they are re-encoded
    ///     as JPEG of at most `ClayverAttachmentRules.maxSize` (see `ClayverImageCompressor`).
    ///     When `nil`, it is inferred from the file name extension.
    public init(data: Data, fileName: String, contentType: String? = nil, width: Int? = nil, height: Int? = nil) {
        self.data = data
        self.fileName = fileName
        self.contentType = contentType ?? ClayverAttachmentRules.contentType(forFileName: fileName) ?? "application/octet-stream"
        self.width = width
        self.height = height
    }

    public var isImage: Bool { contentType.hasPrefix("image/") }
}

/// A customer property value. Strings are limited to 1000 characters.
public enum ClayverValue: Equatable, Hashable, Sendable,
    ExpressibleByStringLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)

    public init(stringLiteral value: String) { self = .string(value) }
    public init(integerLiteral value: Int) { self = .int(value) }
    public init(floatLiteral value: Double) { self = .double(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }

    /// The value as written to the Realtime Database.
    var firebaseValue: Any {
        switch self {
        case .string(let value): return value
        case .int(let value): return NSNumber(value: value)
        case .double(let value): return NSNumber(value: value)
        case .bool(let value): return NSNumber(value: value)
        }
    }
}

/// `config/public` of the workspace.
public struct ClayverPublicConfig: Equatable, Sendable {
    public let teamName: String?
    public let welcomeMessage: String?
    /// Hex color such as `#4F46E5`, as set in the dashboard.
    public let accentColor: String?

    public init(teamName: String?, welcomeMessage: String?, accentColor: String?) {
        self.teamName = teamName
        self.welcomeMessage = welcomeMessage
        self.accentColor = accentColor
    }
}
