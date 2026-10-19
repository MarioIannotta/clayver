import Foundation
import Combine

/// A message row in the chat, including local sends that are still in flight.
public struct ClayverChatMessageItem: Identifiable, Equatable {
    public enum Delivery: Equatable {
        case sending
        case sent
        case failed(String)
    }

    /// The message id, or `local-{clientMessageId}` while sending.
    public let id: String
    public let message: ClayverMessage
    public let delivery: Delivery
    /// The attachment being uploaded, for local sends.
    public let localAttachment: ClayverAttachmentInput?
    /// `true` on the last message of the viewer's side that the other side has read
    /// (customer chat: the team read it; agent mode: the customer read it).
    public let isSeen: Bool
    /// Whether the message is drawn on the viewer's side: customer messages in the customer
    /// chat, team (agent and system) messages in agent mode.
    public let isOutgoing: Bool

    public var isFromCustomer: Bool { message.isFromCustomer }

    init(id: String, message: ClayverMessage, delivery: Delivery, localAttachment: ClayverAttachmentInput?, isSeen: Bool, isOutgoing: Bool? = nil) {
        self.id = id
        self.message = message
        self.delivery = delivery
        self.localAttachment = localAttachment
        self.isSeen = isSeen
        self.isOutgoing = isOutgoing ?? message.isFromCustomer
    }
}

/// One row of the message list.
public enum ClayverChatRow: Identifiable, Equatable {
    case day(Date)
    case newMessagesDivider
    case message(ClayverChatMessageItem)

    public var id: String {
        switch self {
        case .day(let date): return "day-\(Int(date.timeIntervalSince1970))"
        case .newMessagesDivider: return "new-messages-divider"
        case .message(let item): return item.id
        }
    }
}

/// State and logic of the chat screen. Depends only on `ClayverChatDataSource`.
@MainActor
public final class ClayverChatViewModel: ObservableObject {
    public enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    typealias PendingSend = ClayverPendingSend

    @Published public private(set) var loadState: LoadState = .idle
    @Published public private(set) var rows: [ClayverChatRow] = []
    @Published public private(set) var conversationId: String?
    @Published public private(set) var hasOlderMessages = false
    @Published public private(set) var isLoadingOlder = false
    @Published public private(set) var olderMessagesError: String?
    /// A live-update failure after the conversation loaded; the list stays visible.
    @Published public private(set) var connectionError: String?
    /// A one-off error to show in an alert (e.g. attachment rejected).
    @Published public var alertMessage: String?
    @Published public var draft: String = ""
    @Published public private(set) var teamName: String?
    @Published public private(set) var welcomeMessage: String?
    /// The customer's active block (`moderation/{cid}`), or `nil`. While blocked, the chat shows
    /// a notice instead of the composer.
    @Published public private(set) var blockStatus: ClayverBlockStatus?

    public var isBlocked: Bool { blockStatus != nil }

    /// An empty chat for a new conversation: the latest conversation is not loaded, and the
    /// first message creates a conversation.
    public let startsNewConversation: Bool
    public let pageSize: Int
    private let dataSource: ClayverChatDataSource
    private let calendar: Calendar
    private let now: () -> Date
    private let files: ClayverAttachmentFiles

    private var confirmed: [String: ClayverMessage] = [:]
    private var pending: [PendingSend] = []
    private var agentLastReadAt: Date?
    private var initialCustomerReadAt: Date?
    private var dividerBeforeId: String?
    private var dividerResolved = false
    private var listeningTo: String?
    private var listenerTasks: [Task<Void, Never>] = []
    private var bootstrapTask: Task<Void, Never>?
    private var blockTask: Task<Void, Never>?
    private var sendChain: Task<Void, Never>?
    private var isVisible = false
    private var receivedFirstBatch = false
    private var generation = 0
    private var lastMarkedReadId: String?

    /// - Parameters:
    ///   - conversationId: The conversation to show. `nil` loads the latest conversation, unless
    ///     `startsNewConversation` is set.
    ///   - startsNewConversation: With no `conversationId`, starts empty and sends the first
    ///     message to a new conversation (`ClayverChatDataSource.startConversation`).
    public init(
        dataSource: ClayverChatDataSource,
        conversationId: String? = nil,
        startsNewConversation: Bool = false,
        pageSize: Int = 30,
        calendar: Calendar = .current,
        now: @escaping () -> Date = Date.init
    ) {
        self.dataSource = dataSource
        self.conversationId = conversationId
        self.startsNewConversation = startsNewConversation && conversationId == nil
        self.pageSize = max(1, pageSize)
        self.calendar = calendar
        self.now = now
        self.files = ClayverAttachmentFiles(resolve: { [dataSource] path in try await dataSource.attachmentURL(storagePath: path) })
    }

    deinit {
        bootstrapTask?.cancel()
        blockTask?.cancel()
        listenerTasks.forEach { $0.cancel() }
    }

    // MARK: - Lifecycle

    /// Loads the conversation and starts listening. Safe to call repeatedly.
    public func start() {
        if blockTask == nil { listenToBlockStatus() }
        guard bootstrapTask == nil, listeningTo == nil else { return }
        if loadState != .loaded { loadState = .loading }
        generation += 1
        let generation = self.generation
        bootstrapTask = Task { [weak self] in
            await self?.bootstrap(generation: generation)
        }
    }

    /// Stops all listeners (e.g. when the screen goes away for good).
    public func stop() {
        bootstrapTask?.cancel()
        bootstrapTask = nil
        blockTask?.cancel()
        blockTask = nil
        stopListening()
    }

    /// Retries after a load or connection failure.
    public func retry() {
        stop()
        connectionError = nil
        if case .failed = loadState { loadState = .loading }
        start()
    }

    /// Tell the model whether the chat is on screen; visible chats mark incoming messages read.
    public func setVisible(_ visible: Bool) {
        isVisible = visible
        if visible { markReadIfNeeded() }
    }

    private func bootstrap(generation: Int) async {
        defer { if generation == self.generation { bootstrapTask = nil } }
        async let config = try? dataSource.publicConfig()
        do {
            if conversationId == nil && !startsNewConversation {
                conversationId = try await dataSource.latestConversationId()
            }
            try Task.checkCancellation()
            if let conversationId {
                initialCustomerReadAt = try? await dataSource.customerLastReadAt(conversationId: conversationId)
                try Task.checkCancellation()
                listen(to: conversationId)
            } else {
                loadState = .loaded
                rebuildRows()
            }
        } catch is CancellationError {
            return
        } catch {
            loadState = .failed(Self.describe(error))
        }
        if let config = await config {
            teamName = config.teamName
            welcomeMessage = config.welcomeMessage
        }
    }

    private func listen(to conversationId: String) {
        stopListening()
        listeningTo = conversationId
        receivedFirstBatch = false
        let dataSource = self.dataSource
        let pageSize = self.pageSize

        let messagesTask = Task { [weak self] in
            do {
                for try await batch in dataSource.messages(conversationId: conversationId, limit: pageSize) {
                    self?.applyLive(batch)
                }
            } catch is CancellationError {
            } catch {
                self?.handleStreamError(error)
            }
        }
        let readsTask = Task { [weak self] in
            do {
                for try await date in dataSource.agentLastReadAt(conversationId: conversationId) {
                    self?.agentLastReadAt = date
                    self?.rebuildRows()
                }
            } catch {
                // Read receipts are best-effort.
            }
        }
        listenerTasks = [messagesTask, readsTask]
    }

    private func listenToBlockStatus() {
        let dataSource = self.dataSource
        blockTask = Task { [weak self] in
            do {
                for try await status in dataSource.blockStatus() {
                    self?.blockStatus = status
                }
            } catch {
                // Best-effort: a blocked send still fails with a "Not sent" row.
            }
        }
    }

    private func stopListening() {
        listenerTasks.forEach { $0.cancel() }
        listenerTasks = []
        listeningTo = nil
    }

    private func handleStreamError(_ error: Error) {
        listeningTo = nil
        if loadState == .loaded {
            connectionError = Self.describe(error)
        } else {
            loadState = .failed(Self.describe(error))
        }
    }

    // MARK: - Messages

    func applyLive(_ batch: [ClayverMessage]) {
        for message in batch { upsert(message) }
        if !receivedFirstBatch {
            receivedFirstBatch = true
            hasOlderMessages = batch.count >= pageSize
            resolveDivider()
        }
        connectionError = nil
        loadState = .loaded
        rebuildRows()
        markReadIfNeeded()
    }

    private func upsert(_ message: ClayverMessage) {
        confirmed[message.id] = message
        if let clientId = message.clientMessageId {
            pending.removeAll { $0.clientMessageId == clientId }
        }
    }

    private func resolveDivider() {
        guard !dividerResolved else { return }
        dividerResolved = true
        let sorted = confirmed.values.sorted { $0.id < $1.id }
        // Only when the customer has history in this conversation; a brand-new conversation's
        // welcome message should not be flagged as "new".
        guard sorted.contains(where: { $0.isFromCustomer }) || initialCustomerReadAt != nil else { return }
        let lastRead = initialCustomerReadAt ?? .distantPast
        dividerBeforeId = sorted.first(where: { !$0.isFromCustomer && $0.createdAt > lastRead })?.id
    }

    /// Loads one page of history before the oldest loaded message.
    public func loadOlder() async {
        guard let conversationId, hasOlderMessages, !isLoadingOlder else { return }
        guard let oldest = confirmed.keys.min() else { return }
        isLoadingOlder = true
        olderMessagesError = nil
        defer { isLoadingOlder = false }
        do {
            let older = try await dataSource.loadOlderMessages(conversationId: conversationId, before: oldest, limit: pageSize)
            for message in older { upsert(message) }
            hasOlderMessages = older.count >= pageSize
            rebuildRows()
        } catch is CancellationError {
        } catch {
            olderMessagesError = Self.describe(error)
        }
    }

    // MARK: - Sending

    /// Sends the current draft.
    public func sendDraft() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard text.utf16.count <= ClayverValidation.maxTextLength else {
            alertMessage = ClayverError.invalidArgument("Messages are limited to \(ClayverValidation.maxTextLength) characters.").localizedDescription
            return
        }
        draft = ""
        enqueue(text: text, attachment: nil)
    }

    /// Sends an image attachment, compressed to a JPEG of at most
    /// `ClayverAttachmentRules.maxSize` and validated before anything is uploaded.
    public func send(attachment: ClayverAttachmentInput) {
        let prepared: ClayverAttachmentInput
        do {
            prepared = try ClayverAttachmentRules.prepared(attachment)
        } catch {
            alertMessage = Self.describe(error)
            return
        }
        enqueue(text: nil, attachment: prepared)
    }

    /// Re-sends a failed message.
    public func retrySend(id: String) {
        guard let index = pending.firstIndex(where: { Self.localId($0.clientMessageId) == id }) else { return }
        pending[index].failure = nil
        rebuildRows()
        perform(pending[index])
    }

    /// Drops a failed message.
    public func discardFailed(id: String) {
        pending.removeAll { Self.localId($0.clientMessageId) == id && $0.failure != nil }
        rebuildRows()
    }

    private func enqueue(text: String?, attachment: ClayverAttachmentInput?) {
        let send = PendingSend(clientMessageId: UUID().uuidString, text: text, attachment: attachment, createdAt: now(), failure: nil)
        pending.append(send)
        if loadState != .loaded { loadState = .loaded }
        rebuildRows()
        perform(send)
    }

    /// Sends are chained so they reach the server in order and only one creates a conversation.
    private func perform(_ send: PendingSend) {
        let previous = sendChain
        sendChain = Task { [weak self] in
            await previous?.value
            await self?.execute(send)
        }
    }

    private func execute(_ send: PendingSend) async {
        let createsConversation = conversationId == nil
        do {
            let message: ClayverMessage
            if createsConversation && startsNewConversation {
                message = try await dataSource.startConversation(
                    text: send.text,
                    attachment: send.attachment,
                    clientMessageId: send.clientMessageId
                )
            } else {
                message = try await dataSource.sendMessage(
                    text: send.text,
                    conversationId: conversationId,
                    attachment: send.attachment,
                    clientMessageId: send.clientMessageId
                )
            }
            pending.removeAll { $0.clientMessageId == send.clientMessageId }
            upsert(message)
            if createsConversation || listeningTo == nil {
                if createsConversation {
                    // A conversation created now has no unread history to mark.
                    dividerResolved = true
                }
                conversationId = message.conversationId
                listen(to: message.conversationId)
            }
            rebuildRows()
        } catch {
            if let index = pending.firstIndex(where: { $0.clientMessageId == send.clientMessageId }) {
                pending[index].failure = Self.describe(error)
            }
            rebuildRows()
        }
    }

    // MARK: - Read state

    private func markReadIfNeeded() {
        guard isVisible, let conversationId, loadState == .loaded else { return }
        guard let latestIncoming = confirmed.values.filter({ !$0.isFromCustomer }).map(\.id).max() else { return }
        guard latestIncoming != lastMarkedReadId else { return }
        lastMarkedReadId = latestIncoming
        let dataSource = self.dataSource
        Task { [weak self] in
            do {
                try await dataSource.markConversationRead(conversationId: conversationId)
            } catch {
                // Retry on the next update.
                if self?.lastMarkedReadId == latestIncoming { self?.lastMarkedReadId = nil }
            }
        }
    }

    // MARK: - Rows

    private func rebuildRows() {
        rows = Self.buildRows(
            confirmed: Array(confirmed.values),
            pending: pending,
            dividerBeforeId: dividerBeforeId,
            agentLastReadAt: agentLastReadAt,
            calendar: calendar
        )
    }

    static func localId(_ clientMessageId: String) -> String { ClayverThreadLayout.localId(clientMessageId) }

    /// Pure row layout: day headers, the "New messages" divider, confirmed messages in key
    /// order followed by local sends, and "Seen" on the last customer message the team read.
    static func buildRows(
        confirmed: [ClayverMessage],
        pending: [PendingSend],
        dividerBeforeId: String?,
        agentLastReadAt: Date?,
        calendar: Calendar
    ) -> [ClayverChatRow] {
        ClayverThreadLayout.rows(
            confirmed: confirmed,
            pending: pending,
            perspective: .customer,
            pendingSender: (id: "", type: .customer),
            dividerBeforeId: dividerBeforeId,
            otherSideLastReadAt: agentLastReadAt,
            calendar: calendar
        )
    }

    // MARK: - Attachments

    /// A download URL for an attachment, cached for the lifetime of the screen.
    public func url(for attachment: ClayverAttachment) async throws -> URL {
        try await files.url(for: attachment)
    }

    /// Downloads an attachment to a temporary file named after it (for Quick Look).
    public func localFile(for attachment: ClayverAttachment) async throws -> URL {
        try await files.localFile(for: attachment)
    }

    static func describe(_ error: Error) -> String {
        ClayverError.from(error).localizedDescription
    }
}

extension ClayverChatViewModel: ClayverThreadModel {
    var perspective: ClayverMessagePerspective { .customer }
}
