import Foundation
import Combine

/// One row of the agent inbox.
public struct ClayverAgentInboxRow: Identifiable, Equatable {
    /// The conversation id.
    public let id: String
    public let customerId: String
    /// `properties.name`, else the external id, else a short customer id.
    public let customerName: String
    /// The last message's text on one line, "Attachment" for attachments, or "No messages yet".
    public let preview: String
    /// Whether the conversation has a last message at all.
    public let hasMessages: Bool
    /// Whether the last message came from the customer (else from the team).
    public let lastMessageFromCustomer: Bool
    public let lastActivityAt: Date?
    /// Customer messages the team has not read (`unread.agent`).
    public let unreadCount: Int
    public let status: ClayverConversationStatus
    public let assigneeUid: String?
    public let isAssignedToMe: Bool

    public var isAssigned: Bool { assigneeUid != nil }
}

/// State and logic of the agent inbox. Depends only on `ClayverAgentDataSource`.
@MainActor
public final class ClayverAgentInboxViewModel: ObservableObject {
    public enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    @Published public private(set) var loadState: LoadState = .idle
    /// The selected tab.
    @Published public private(set) var status: ClayverConversationStatus
    @Published public private(set) var rows: [ClayverAgentInboxRow] = []
    @Published public private(set) var agentUid: String?
    /// The tag catalog, by name, for the filter row.
    @Published public private(set) var tags: [ClayverTag] = []
    /// The tag filter; `nil` shows all conversations.
    @Published public private(set) var selectedTagId: String?

    public let limit: Int
    let dataSource: ClayverAgentDataSource

    private var conversations: [ClayverAgentConversation] = []
    private var profiles: [String: ClayverCustomerProfile] = [:]
    private var profileRequests: Set<String> = []
    private var listenTask: Task<Void, Never>?
    private var tagsTask: Task<Void, Never>?
    private var generation = 0

    public init(dataSource: ClayverAgentDataSource, status: ClayverConversationStatus = .open, limit: Int = 50) {
        self.dataSource = dataSource
        self.status = status == .closed ? .closed : .open
        self.limit = max(1, limit)
    }

    deinit {
        listenTask?.cancel()
        tagsTask?.cancel()
    }

    // MARK: - Lifecycle

    /// Starts listening to the selected tab. Safe to call repeatedly.
    public func start() {
        if tagsTask == nil { listenToTags() }
        guard listenTask == nil else { return }
        if loadState != .loaded || rows.isEmpty { loadState = .loading }
        generation += 1
        let generation = self.generation
        let dataSource = self.dataSource
        let status = self.status
        let limit = self.limit
        let tagId = self.selectedTagId
        listenTask = Task { [weak self] in
            do {
                let uid = try await dataSource.currentAgentUid()
                try Task.checkCancellation()
                self?.setAgentUid(uid, generation: generation)
                for try await batch in dataSource.agentConversations(status: status, limit: limit, tagId: tagId) {
                    self?.apply(batch, generation: generation)
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

    /// Switches between the Open and Closed tabs.
    public func select(status newStatus: ClayverConversationStatus) {
        guard newStatus != .unknown, newStatus != status else { return }
        stop()
        status = newStatus
        conversations = []
        rows = []
        loadState = .loading
        start()
    }

    /// Shows only conversations with the tag `tagId`, or all of them for `nil`.
    public func select(tagId newTagId: String?) {
        guard newTagId != selectedTagId else { return }
        stop()
        selectedTagId = newTagId
        conversations = []
        rows = []
        loadState = .loading
        start()
    }

    /// A view model for one of the inbox's conversations, using the same data source.
    public func conversationViewModel(for conversationId: String) -> ClayverAgentConversationViewModel {
        ClayverAgentConversationViewModel(dataSource: dataSource, conversationId: conversationId)
    }

    // MARK: - Updates

    private func listenToTags() {
        let dataSource = self.dataSource
        tagsTask = Task { [weak self] in
            do {
                for try await tags in dataSource.tags() {
                    self?.applyTags(tags)
                }
            } catch {
                // The filter row stays hidden; the inbox itself reports permission problems.
            }
        }
    }

    func applyTags(_ tags: [ClayverTag]) {
        self.tags = ClayverTag.sortedByName(tags)
        // A deleted tag can't stay selected.
        if let selectedTagId, !tags.contains(where: { $0.id == selectedTagId }) {
            select(tagId: nil)
        }
    }

    private func setAgentUid(_ uid: String, generation: Int) {
        guard generation == self.generation else { return }
        agentUid = uid
    }

    func apply(_ batch: [ClayverAgentConversation], generation: Int) {
        guard generation == self.generation else { return }
        conversations = batch
        loadState = .loaded
        rebuildRows()
        requestProfiles(for: batch.map(\.customerId))
    }

    private func fail(_ error: Error, generation: Int) {
        guard generation == self.generation else { return }
        listenTask = nil
        loadState = .failed(Self.describe(error))
    }

    private func requestProfiles(for customerIds: [String]) {
        let dataSource = self.dataSource
        for customerId in Set(customerIds) where profiles[customerId] == nil && !profileRequests.contains(customerId) {
            profileRequests.insert(customerId)
            Task { [weak self] in
                do {
                    let profile = try await dataSource.fetchCustomerProfile(customerId: customerId)
                    self?.store(profile)
                } catch {
                    // Names fall back to the customer id; retried with the next update.
                    self?.profileRequests.remove(customerId)
                }
            }
        }
    }

    private func store(_ profile: ClayverCustomerProfile) {
        profiles[profile.customerId] = profile
        profileRequests.remove(profile.customerId)
        rebuildRows()
    }

    private func rebuildRows() {
        rows = Self.buildRows(conversations: conversations, profiles: profiles, agentUid: agentUid)
    }

    // MARK: - Pure mapping

    /// Maps conversations to rows, newest activity first.
    static func buildRows(
        conversations: [ClayverAgentConversation],
        profiles: [String: ClayverCustomerProfile],
        agentUid: String?
    ) -> [ClayverAgentInboxRow] {
        ClayverParsing.sortedNewestFirst(conversations).map { conversation in
            row(for: conversation, profile: profiles[conversation.customerId], agentUid: agentUid)
        }
    }

    static func row(for conversation: ClayverAgentConversation, profile: ClayverCustomerProfile?, agentUid: String?) -> ClayverAgentInboxRow {
        ClayverAgentInboxRow(
            id: conversation.id,
            customerId: conversation.customerId,
            customerName: ClayverCustomerProfile.displayName(customerId: conversation.customerId, profile: profile),
            preview: preview(conversation.lastMessage),
            hasMessages: conversation.lastMessage != nil,
            lastMessageFromCustomer: conversation.lastMessage?.senderType == .customer,
            lastActivityAt: conversation.lastActivityAt,
            unreadCount: conversation.unreadForAgents,
            status: conversation.status,
            assigneeUid: conversation.assigneeUid,
            isAssignedToMe: agentUid != nil && conversation.assigneeUid == agentUid
        )
    }

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

    static func describe(_ error: Error) -> String {
        if case .permissionDenied = ClayverError.from(error) {
            return "This account is not a support agent for this workspace."
        }
        return ClayverError.from(error).localizedDescription
    }
}
