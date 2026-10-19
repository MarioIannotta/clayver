import Foundation
import Combine

/// One row of the customer's conversation list.
public struct ClayverConversationListRow: Identifiable, Equatable {
    /// The conversation id.
    public let id: String
    /// The last message's text on one line, "Attachment" for attachments, or "No messages yet".
    public let preview: String
    /// Whether the conversation has a last message at all.
    public let hasMessages: Bool
    /// Whether the last message came from the customer (else from the team).
    public let lastMessageFromCustomer: Bool
    public let lastActivityAt: Date?
    /// Messages from the team the customer has not read (`unread.customer`).
    public let unreadCount: Int
    /// The conversation is closed. Writing in it reopens it. Not shown by the SDK's customer
    /// UI: customers are not told that the team closed a conversation.
    public let isResolved: Bool
}

/// Pure layout of the conversation list: order, previews and time labels.
enum ClayverConversationListLayout {
    /// Time of the latest activity: `updatedAt`, else the last message, else `createdAt`.
    static func lastActivity(_ conversation: ClayverConversation) -> Date? {
        conversation.updatedAt ?? conversation.lastMessage?.createdAt ?? conversation.createdAt
    }

    /// Newest activity first; ties by id, newest push id first.
    static func sorted(_ conversations: [ClayverConversation]) -> [ClayverConversation] {
        conversations.sorted { lhs, rhs in
            let l = lastActivity(lhs) ?? .distantPast
            let r = lastActivity(rhs) ?? .distantPast
            return l == r ? lhs.id > rhs.id : l > r
        }
    }

    static func rows(_ conversations: [ClayverConversation]) -> [ClayverConversationListRow] {
        sorted(conversations).map(row(for:))
    }

    static func row(for conversation: ClayverConversation) -> ClayverConversationListRow {
        ClayverConversationListRow(
            id: conversation.id,
            preview: preview(conversation.lastMessage),
            hasMessages: conversation.lastMessage != nil,
            lastMessageFromCustomer: conversation.lastMessage?.senderType == .customer,
            lastActivityAt: lastActivity(conversation),
            unreadCount: max(0, conversation.unreadCount),
            isResolved: conversation.status == .closed
        )
    }

    /// The last message on one line, "Attachment" when it has no text, "No messages yet" without one.
    static func preview(_ lastMessage: ClayverConversation.LastMessage?) -> String {
        guard let lastMessage else { return "No messages yet" }
        let text = (lastMessage.text ?? "")
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        if !text.isEmpty { return text }
        return lastMessage.hasAttachment ? "Attachment" : "No messages yet"
    }

    /// The time on the right of a row: the time for today, "Yesterday", the weekday within the
    /// last week, else the date.
    static func timeLabel(for date: Date, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = locale
        if calendar.isDate(date, inSameDayAs: now) {
            formatter.dateStyle = .none
            formatter.timeStyle = .short
            return formatter.string(from: date)
        }
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day ?? 0
        if days == 1 { return "Yesterday" }
        if days > 1 && days < 7 {
            formatter.setLocalizedDateFormatFromTemplate("EEEE")
        } else if calendar.isDate(date, equalTo: now, toGranularity: .year) {
            formatter.setLocalizedDateFormatFromTemplate("MMMd")
        } else {
            formatter.dateStyle = .short
            formatter.timeStyle = .none
        }
        return formatter.string(from: date)
    }
}

/// State of the customer's conversation list (`inbox/{cid}/conversations`). Depends only on
/// `ClayverChatDataSource`.
@MainActor
public final class ClayverConversationListViewModel: ObservableObject {
    public typealias LoadState = ClayverChatViewModel.LoadState

    @Published public private(set) var loadState: LoadState = .idle
    /// Newest activity first.
    @Published public private(set) var rows: [ClayverConversationListRow] = []
    @Published public private(set) var teamName: String?

    let dataSource: ClayverChatDataSource
    private var listenTask: Task<Void, Never>?
    private var configTask: Task<Void, Never>?
    private var generation = 0

    public init(dataSource: ClayverChatDataSource) {
        self.dataSource = dataSource
    }

    deinit {
        listenTask?.cancel()
        configTask?.cancel()
    }

    // MARK: - Lifecycle

    /// Starts listening to the list. Safe to call repeatedly.
    public func start() {
        if configTask == nil { loadConfig() }
        guard listenTask == nil else { return }
        if loadState != .loaded { loadState = .loading }
        generation += 1
        let generation = self.generation
        let dataSource = self.dataSource
        listenTask = Task { [weak self] in
            do {
                for try await conversations in dataSource.conversations() {
                    self?.apply(conversations, generation: generation)
                }
            } catch is CancellationError {
            } catch {
                self?.fail(error, generation: generation)
            }
        }
    }

    public func stop() {
        listenTask?.cancel()
        listenTask = nil
        generation += 1
    }

    public func retry() {
        stop()
        loadState = .loading
        start()
    }

    /// A chat view model for one of the listed conversations, using the same data source.
    public func chatViewModel(for conversationId: String) -> ClayverChatViewModel {
        ClayverChatViewModel(dataSource: dataSource, conversationId: conversationId)
    }

    /// A chat view model for a new, empty conversation, using the same data source.
    public func newConversationViewModel() -> ClayverChatViewModel {
        ClayverChatViewModel(dataSource: dataSource, startsNewConversation: true)
    }

    // MARK: - Updates

    func apply(_ conversations: [ClayverConversation], generation: Int) {
        guard generation == self.generation else { return }
        rows = ClayverConversationListLayout.rows(conversations)
        loadState = .loaded
    }

    private func fail(_ error: Error, generation: Int) {
        guard generation == self.generation else { return }
        listenTask = nil
        loadState = .failed(ClayverChatViewModel.describe(error))
    }

    private func loadConfig() {
        let dataSource = self.dataSource
        configTask = Task { [weak self] in
            if let config = try? await dataSource.publicConfig() {
                self?.teamName = config.teamName
            }
        }
    }
}
