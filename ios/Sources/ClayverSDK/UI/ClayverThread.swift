import Foundation
import Combine

/// Whose screen a message list is drawn for. Decides which side a bubble sits on and how
/// senders are named.
enum ClayverMessagePerspective: Equatable {
    /// The customer chat: customer messages on the right.
    case customer
    /// Agent mode: team messages (agent and system) on the right, customer messages on the left.
    case agent(myUid: String?, customerName: String)

    /// Whether `message` is drawn on the viewer's (right) side.
    func isOutgoing(_ message: ClayverMessage) -> Bool {
        switch self {
        case .customer: return message.senderType == .customer
        case .agent: return message.senderType == .agent || message.senderType == .system
        }
    }

    /// The small label above a bubble, or `nil` for none.
    func senderLabel(for message: ClayverMessage) -> String? {
        switch self {
        case .customer:
            return message.senderType == .agent ? (message.senderName ?? "Support") : nil
        case .agent(let myUid, _):
            switch message.senderType {
            case .agent:
                return message.senderId == myUid || message.senderId.isEmpty ? nil : (message.senderName ?? "Teammate")
            case .system:
                return "Automated message"
            default:
                return nil
            }
        }
    }

    /// Who sent the message, for VoiceOver.
    func spokenSender(for message: ClayverMessage) -> String {
        switch self {
        case .customer:
            switch message.senderType {
            case .customer: return "You"
            case .system: return "Notice"
            default: return message.senderName ?? "Support"
            }
        case .agent(let myUid, let customerName):
            switch message.senderType {
            case .customer: return customerName
            case .system: return "Automated message"
            case .agent:
                return message.senderId == myUid || message.senderId.isEmpty ? "You" : (message.senderName ?? "Teammate")
            case .unknown: return "Unknown sender"
            }
        }
    }
}

/// A message the viewer is sending that the server has not confirmed yet.
struct ClayverPendingSend: Equatable {
    let clientMessageId: String
    let text: String?
    let attachment: ClayverAttachmentInput?
    let createdAt: Date
    var failure: String?
}

/// Row layout shared by the customer chat and the agent conversation.
enum ClayverThreadLayout {
    static func localId(_ clientMessageId: String) -> String { "local-\(clientMessageId)" }

    /// Day headers, the "New messages" divider, confirmed messages in key order followed by
    /// local sends, and "Seen" on the last outgoing (non-system) message the other side read.
    static func rows(
        confirmed: [ClayverMessage],
        pending: [ClayverPendingSend],
        perspective: ClayverMessagePerspective,
        pendingSender: (id: String, type: ClayverMessage.SenderType),
        dividerBeforeId: String?,
        otherSideLastReadAt: Date?,
        calendar: Calendar
    ) -> [ClayverChatRow] {
        let sorted = confirmed.sorted { $0.id < $1.id }
        let seenId: String? = otherSideLastReadAt.flatMap { readAt in
            sorted.last(where: {
                perspective.isOutgoing($0) && $0.senderType != .system && $0.createdAt <= readAt
            })?.id
        }

        var items: [ClayverChatMessageItem] = sorted.map {
            ClayverChatMessageItem(
                id: $0.id, message: $0, delivery: .sent, localAttachment: nil,
                isSeen: $0.id == seenId, isOutgoing: perspective.isOutgoing($0)
            )
        }
        for send in pending {
            let message = ClayverMessage(
                id: localId(send.clientMessageId),
                conversationId: "",
                senderId: pendingSender.id,
                senderType: pendingSender.type,
                text: send.text,
                attachment: nil,
                createdAt: send.createdAt,
                clientMessageId: send.clientMessageId
            )
            items.append(ClayverChatMessageItem(
                id: message.id,
                message: message,
                delivery: send.failure.map { .failed($0) } ?? .sending,
                localAttachment: send.attachment,
                isSeen: false,
                isOutgoing: true
            ))
        }

        var rows: [ClayverChatRow] = []
        var lastDay: Date?
        for item in items {
            let day = calendar.startOfDay(for: item.message.createdAt)
            if day != lastDay {
                rows.append(.day(day))
                lastDay = day
            }
            if item.id == dividerBeforeId { rows.append(.newMessagesDivider) }
            rows.append(.message(item))
        }
        return rows
    }
}

/// Download URLs and Quick Look copies of attachments, cached for the lifetime of a screen.
@MainActor
final class ClayverAttachmentFiles {
    private let resolve: (String) async throws -> URL
    private var cache: [String: URL] = [:]

    init(resolve: @escaping (String) async throws -> URL) {
        self.resolve = resolve
    }

    func url(for attachment: ClayverAttachment) async throws -> URL {
        if let cached = cache[attachment.storagePath] { return cached }
        let url = try await resolve(attachment.storagePath)
        cache[attachment.storagePath] = url
        return url
    }

    /// Downloads an attachment to a temporary file named after it (for Quick Look).
    func localFile(for attachment: ClayverAttachment) async throws -> URL {
        let remote = try await url(for: attachment)
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("clayver", isDirectory: true)
            .appendingPathComponent(String(attachment.storagePath.hashValue, radix: 36), isDirectory: true)
        let destination = folder.appendingPathComponent(ClayverAttachmentRules.sanitizedFileName(attachment.fileName))
        if FileManager.default.fileExists(atPath: destination.path) { return destination }
        let (downloaded, _) = try await URLSession.shared.download(from: remote)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: downloaded, to: destination)
        return destination
    }
}

/// What the shared message list and composer need from a screen's view model. Implemented by
/// `ClayverChatViewModel` (customer) and `ClayverAgentConversationViewModel` (agent mode).
@MainActor
protocol ClayverThreadModel: ObservableObject {
    var rows: [ClayverChatRow] { get }
    var hasOlderMessages: Bool { get }
    var isLoadingOlder: Bool { get }
    var olderMessagesError: String? { get }
    var draft: String { get set }
    var alertMessage: String? { get set }
    var perspective: ClayverMessagePerspective { get }
    func loadOlder() async
    func sendDraft()
    func send(attachment: ClayverAttachmentInput)
    func retrySend(id: String)
    func discardFailed(id: String)
    func url(for attachment: ClayverAttachment) async throws -> URL
}
