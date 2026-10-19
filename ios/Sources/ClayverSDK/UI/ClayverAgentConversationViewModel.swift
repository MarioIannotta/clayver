import Foundation
import Combine

/// State and logic of the agent conversation screen. Depends only on `ClayverAgentDataSource`.
///
/// Messages are laid out from the team's perspective: customer messages on the left, agent
/// (and system) messages on the right, "Seen" on the last team message the customer read.
@MainActor
public final class ClayverAgentConversationViewModel: ObservableObject {
    public typealias LoadState = ClayverChatViewModel.LoadState

    @Published public private(set) var loadState: LoadState = .idle
    @Published public private(set) var rows: [ClayverChatRow] = []
    @Published public private(set) var hasOlderMessages = false
    @Published public private(set) var isLoadingOlder = false
    @Published public private(set) var olderMessagesError: String?
    /// A live-update failure after the conversation loaded; the list stays visible.
    @Published public private(set) var connectionError: String?
    /// A one-off error to show in an alert.
    @Published public var alertMessage: String?
    @Published public var draft: String = ""
    /// The live `conversations/{id}` record (status, assignee, unread).
    @Published public private(set) var conversation: ClayverAgentConversation?
    @Published public private(set) var profile: ClayverCustomerProfile?
    @Published public private(set) var agentUid: String?
    /// A status or assignment change is in flight.
    @Published public private(set) var isUpdating = false
    /// The workspace tag catalog, by name.
    @Published public private(set) var allTags: [ClayverTag] = []
    /// Ids of the tags on this conversation (`conversationTags/{id}`), with local changes applied
    /// until the server confirms them.
    @Published public private(set) var tagIds: [String] = []
    /// Priority and status (`triage/{id}`), with a local change applied until it is confirmed.
    @Published public private(set) var triage: ClayverTriage = .none
    /// The workspace's priority and status lists.
    @Published public private(set) var triageOptions: ClayverTriageOptions = .defaults
    /// A priority or status change is in flight.
    @Published public private(set) var isUpdatingTriage = false
    /// Internal notes, newest first.
    @Published public private(set) var notes: [ClayverInternalNote] = []
    /// A note is being added.
    @Published public private(set) var isAddingNote = false
    /// All conversations of this conversation's customer, newest activity first.
    @Published public private(set) var customerConversations: [ClayverAgentConversation] = []
    /// The customer's active block, or `nil`.
    @Published public private(set) var blockStatus: ClayverBlockStatus?
    /// A block or unblock is in flight.
    @Published public private(set) var isUpdatingBlock = false
    /// Display names of the team, by uid.
    @Published public private(set) var agentNames: [String: String] = [:]

    public let conversationId: String
    public let pageSize: Int
    private let dataSource: ClayverAgentDataSource
    private let calendar: Calendar
    private let now: () -> Date
    private let files: ClayverAttachmentFiles

    private var confirmed: [String: ClayverMessage] = [:]
    private var pending: [ClayverPendingSend] = []
    private var customerLastReadAt: Date?
    private var initialTeamReadAt: Date?
    private var dividerBeforeId: String?
    private var dividerResolved = false
    private var receivedFirstBatch = false
    private var isListening = false
    private var listenerTasks: [Task<Void, Never>] = []
    private var profileTask: Task<Void, Never>?
    /// Listeners that follow the conversation's customer (history, block).
    private var customerTasks: [Task<Void, Never>] = []
    private var profileCustomerId: String?
    private var bootstrapTask: Task<Void, Never>?
    private var sendChain: Task<Void, Never>?
    private var isVisible = false
    private var generation = 0
    private var lastMarkedReadId: String?
    private var serverTagIds: [String] = []
    /// Tag changes in flight: tag id → whether it is being added.
    private var tagChanges: [String: Bool] = [:]

    public init(
        dataSource: ClayverAgentDataSource,
        conversationId: String,
        pageSize: Int = 30,
        calendar: Calendar = .current,
        now: @escaping () -> Date = Date.init
    ) {
        self.dataSource = dataSource
        self.conversationId = conversationId
        self.pageSize = max(1, pageSize)
        self.calendar = calendar
        self.now = now
        self.files = ClayverAttachmentFiles(resolve: { [dataSource] path in try await dataSource.attachmentURL(storagePath: path) })
    }

    deinit {
        bootstrapTask?.cancel()
        profileTask?.cancel()
        customerTasks.forEach { $0.cancel() }
        listenerTasks.forEach { $0.cancel() }
    }

    // MARK: - Derived state

    /// `properties.name`, else the external id, else a short customer id.
    public var customerName: String {
        guard let customerId = conversation?.customerId ?? profile?.customerId else { return "Customer" }
        return ClayverCustomerProfile.displayName(customerId: customerId, profile: profile)
    }

    public var isClosed: Bool { conversation?.status == .closed }
    public var isAssigned: Bool { conversation?.assigneeUid != nil }
    public var isAssignedToMe: Bool { agentUid != nil && conversation?.assigneeUid == agentUid }

    /// The conversation's tags, by name. Tags missing from the catalog are left out.
    public var tags: [ClayverTag] {
        ClayverTag.sortedByName(allTags.filter { tagIds.contains($0.id) })
    }

    public func hasTag(_ tagId: String) -> Bool { tagIds.contains(tagId) }

    /// The assignee's display name: "You", a teammate's name, or `nil` when unassigned.
    public var assigneeName: String? {
        guard let uid = conversation?.assigneeUid else { return nil }
        if uid == agentUid { return "You" }
        return agentNames[uid] ?? "A teammate"
    }

    /// The conversation's priority option, or `nil` (unset, or not in the workspace's list).
    public var priorityOption: ClayverTriageOption? { triageOptions.option(.priority, id: triage.priority) }

    /// The conversation's status ("stage") option, or `nil` (unset, or not in the list).
    public var stageOption: ClayverTriageOption? { triageOptions.option(.stage, id: triage.stage) }

    /// Whether the signed-in agent wrote the note (and so can delete it).
    public func canDelete(_ note: ClayverInternalNote) -> Bool { agentUid != nil && note.authorUid == agentUid }

    /// A model for another conversation, on the same data source (used to open one of the
    /// customer's other conversations).
    public func makeViewModel(forConversation id: String) -> ClayverAgentConversationViewModel {
        ClayverAgentConversationViewModel(dataSource: dataSource, conversationId: id, pageSize: pageSize, calendar: calendar, now: now)
    }

    // MARK: - Lifecycle

    /// Loads the conversation and starts listening. Safe to call repeatedly.
    public func start() {
        guard bootstrapTask == nil, !isListening else { return }
        if loadState != .loaded { loadState = .loading }
        generation += 1
        let generation = self.generation
        bootstrapTask = Task { [weak self] in
            await self?.bootstrap(generation: generation)
        }
    }

    /// Stops all listeners.
    public func stop() {
        bootstrapTask?.cancel()
        bootstrapTask = nil
        stopListening()
    }

    /// Retries after a load or connection failure.
    public func retry() {
        stop()
        connectionError = nil
        if case .failed = loadState { loadState = .loading }
        start()
    }

    /// Tell the model whether the screen is visible; a visible conversation is marked read
    /// for the team as customer messages arrive.
    public func setVisible(_ visible: Bool) {
        isVisible = visible
        if visible { markReadIfNeeded() }
    }

    private func bootstrap(generation: Int) async {
        defer { if generation == self.generation { bootstrapTask = nil } }
        do {
            let uid = try await dataSource.currentAgentUid()
            try Task.checkCancellation()
            agentUid = uid
            initialTeamReadAt = try? await dataSource.agentLastReadAt(conversationId: conversationId)
            try Task.checkCancellation()
            listen()
        } catch is CancellationError {
            return
        } catch {
            loadState = .failed(ClayverAgentInboxViewModel.describe(error))
        }
    }

    private func listen() {
        stopListening()
        isListening = true
        receivedFirstBatch = false
        let dataSource = self.dataSource
        let conversationId = self.conversationId
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
        let conversationTask = Task { [weak self] in
            do {
                for try await conversation in dataSource.conversation(id: conversationId) {
                    self?.applyConversation(conversation)
                }
            } catch {
                // The message stream reports connection problems.
            }
        }
        let readsTask = Task { [weak self] in
            do {
                for try await date in dataSource.customerLastReadAt(conversationId: conversationId) {
                    self?.customerLastReadAt = date
                    self?.rebuildRows()
                }
            } catch {
                // Read receipts are best-effort.
            }
        }
        let tagsTask = Task { [weak self] in
            do {
                for try await tags in dataSource.tags() {
                    self?.allTags = ClayverTag.sortedByName(tags)
                }
            } catch {
                // Tags are optional; the chips stay empty.
            }
        }
        let conversationTagsTask = Task { [weak self] in
            do {
                for try await ids in dataSource.conversationTags(conversationId: conversationId) {
                    self?.applyServerTagIds(ids)
                }
            } catch {
                // Tags are optional; the chips stay empty.
            }
        }
        let triageTask = Task { [weak self] in
            do {
                for try await triage in dataSource.triage(conversationId: conversationId) {
                    self?.applyServerTriage(triage)
                }
            } catch {
                // Triage is optional; the pickers show "None".
            }
        }
        let triageOptionsTask = Task { [weak self] in
            do {
                for try await options in dataSource.triageOptions() {
                    self?.triageOptions = options
                }
            } catch {
                // Keep the defaults.
            }
        }
        let notesTask = Task { [weak self] in
            do {
                for try await notes in dataSource.notes(conversationId: conversationId) {
                    self?.notes = notes
                }
            } catch {
                // Notes are optional; the list stays empty.
            }
        }
        let agentNamesTask = Task { [weak self] in
            do {
                for try await names in dataSource.agentNames() {
                    self?.agentNames = names
                }
            } catch {
                // Assignees fall back to "A teammate".
            }
        }
        listenerTasks = [messagesTask, conversationTask, readsTask, tagsTask, conversationTagsTask,
                         triageTask, triageOptionsTask, notesTask, agentNamesTask]
    }

    private func stopListening() {
        listenerTasks.forEach { $0.cancel() }
        listenerTasks = []
        profileTask?.cancel()
        profileTask = nil
        customerTasks.forEach { $0.cancel() }
        customerTasks = []
        profileCustomerId = nil
        isListening = false
    }

    private func handleStreamError(_ error: Error) {
        isListening = false
        if loadState == .loaded {
            connectionError = ClayverAgentInboxViewModel.describe(error)
        } else {
            loadState = .failed(ClayverAgentInboxViewModel.describe(error))
        }
    }

    func applyConversation(_ conversation: ClayverAgentConversation?) {
        self.conversation = conversation
        if let customerId = conversation?.customerId, customerId != profileCustomerId {
            listenToProfile(customerId: customerId)
        }
    }

    private func listenToProfile(customerId: String) {
        profileTask?.cancel()
        profileCustomerId = customerId
        let dataSource = self.dataSource
        profileTask = Task { [weak self] in
            do {
                for try await profile in dataSource.customerProfile(customerId: customerId) {
                    self?.profile = profile
                    self?.rebuildRows()
                }
            } catch {
                // The customer info sheet falls back to the customer id.
            }
        }
        customerTasks.forEach { $0.cancel() }
        let historyTask = Task { [weak self] in
            do {
                for try await conversations in dataSource.customerConversations(customerId: customerId) {
                    self?.customerConversations = conversations
                }
            } catch {
                // The details sheet lists only this conversation.
            }
        }
        let blockTask = Task { [weak self] in
            do {
                for try await status in dataSource.customerBlockStatus(customerId: customerId) {
                    self?.blockStatus = status
                }
            } catch {
                // Shown as not blocked.
            }
        }
        customerTasks = [historyTask, blockTask]
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

    /// "New messages" before the first customer message newer than the team read marker.
    private func resolveDivider() {
        guard !dividerResolved else { return }
        dividerResolved = true
        let sorted = confirmed.values.sorted { $0.id < $1.id }
        guard sorted.contains(where: { $0.senderType == .agent }) || initialTeamReadAt != nil else { return }
        let lastRead = initialTeamReadAt ?? .distantPast
        dividerBeforeId = sorted.first(where: { $0.isFromCustomer && $0.createdAt > lastRead })?.id
    }

    /// Loads one page of history before the oldest loaded message.
    public func loadOlder() async {
        guard hasOlderMessages, !isLoadingOlder else { return }
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
            olderMessagesError = ClayverAgentInboxViewModel.describe(error)
        }
    }

    // MARK: - Sending

    /// Sends the current draft as a reply.
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
            alertMessage = ClayverChatViewModel.describe(error)
            return
        }
        enqueue(text: nil, attachment: prepared)
    }

    /// Re-sends a failed reply.
    public func retrySend(id: String) {
        guard let index = pending.firstIndex(where: { ClayverThreadLayout.localId($0.clientMessageId) == id }) else { return }
        pending[index].failure = nil
        rebuildRows()
        perform(pending[index])
    }

    /// Drops a failed reply.
    public func discardFailed(id: String) {
        pending.removeAll { ClayverThreadLayout.localId($0.clientMessageId) == id && $0.failure != nil }
        rebuildRows()
    }

    private func enqueue(text: String?, attachment: ClayverAttachmentInput?) {
        let send = ClayverPendingSend(clientMessageId: UUID().uuidString, text: text, attachment: attachment, createdAt: now(), failure: nil)
        pending.append(send)
        rebuildRows()
        perform(send)
    }

    /// Replies are chained so they reach the server in order.
    private func perform(_ send: ClayverPendingSend) {
        let previous = sendChain
        sendChain = Task { [weak self] in
            await previous?.value
            await self?.execute(send)
        }
    }

    private func execute(_ send: ClayverPendingSend) async {
        do {
            let message = try await dataSource.sendAgentReply(
                conversationId: conversationId,
                text: send.text,
                attachment: send.attachment,
                clientMessageId: send.clientMessageId
            )
            pending.removeAll { $0.clientMessageId == send.clientMessageId }
            upsert(message)
            rebuildRows()
        } catch {
            if let index = pending.firstIndex(where: { $0.clientMessageId == send.clientMessageId }) {
                pending[index].failure = ClayverChatViewModel.describe(error)
            }
            rebuildRows()
        }
    }

    // MARK: - Conversation actions

    /// Opens or closes the conversation. The change shows immediately and is reverted if the
    /// write fails.
    public func setStatus(_ status: ClayverConversationStatus) async {
        guard status != .unknown, !isUpdating else { return }
        isUpdating = true
        defer { isUpdating = false }
        let previous = conversation
        conversation = conversation?.with(status: status)
        do {
            try await dataSource.setConversationStatus(conversationId: conversationId, status: status)
        } catch is CancellationError {
            conversation = previous
        } catch {
            conversation = previous
            alertMessage = ClayverAgentInboxViewModel.describe(error)
        }
    }

    public func close() async { await setStatus(.closed) }
    public func reopen() async { await setStatus(.open) }

    /// Assigns the conversation to the signed-in agent, or removes the assignee.
    public func assign(toMe: Bool) async {
        guard !isUpdating else { return }
        isUpdating = true
        defer { isUpdating = false }
        let previous = conversation
        conversation = conversation?.with(assigneeUid: toMe ? agentUid : nil)
        do {
            try await dataSource.assignConversation(conversationId: conversationId, toMe: toMe)
        } catch is CancellationError {
            conversation = previous
        } catch {
            conversation = previous
            alertMessage = ClayverAgentInboxViewModel.describe(error)
        }
    }

    // MARK: - Priority & status

    /// A triage change in flight overrides the live value until it completes.
    private var pendingTriage: ClayverTriage?
    private var serverTriage: ClayverTriage = .none

    func applyServerTriage(_ value: ClayverTriage) {
        serverTriage = value
        triage = pendingTriage ?? value
    }

    /// Sets the priority to an option id of `triageOptions.priority`, or clears it.
    public func setPriority(_ optionId: String?) async {
        await setTriage(.priority, optionId)
    }

    /// Sets the status ("stage") to an option id of `triageOptions.stage`, or clears it.
    public func setStage(_ optionId: String?) async {
        await setTriage(.stage, optionId)
    }

    /// The change shows immediately and is reverted if the write fails.
    public func setTriage(_ kind: ClayverTriageOption.Kind, _ optionId: String?) async {
        guard !isUpdatingTriage, triage.value(kind) != optionId else { return }
        isUpdatingTriage = true
        let updated = triage.with(kind, optionId)
        pendingTriage = updated
        triage = updated
        do {
            try await dataSource.setTriage(conversationId: conversationId, kind: kind, optionId: optionId)
            serverTriage = serverTriage.with(kind, optionId)
        } catch is CancellationError {
        } catch {
            alertMessage = ClayverAgentInboxViewModel.describe(error)
        }
        pendingTriage = nil
        triage = serverTriage
        isUpdatingTriage = false
    }

    // MARK: - Notes

    /// Adds an internal note. Returns `true` when it was saved (so the field can be cleared).
    @discardableResult
    public func addNote(_ rawText: String) async -> Bool {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isAddingNote else { return false }
        guard text.utf16.count <= ClayverValidation.maxTextLength else {
            alertMessage = ClayverError.invalidArgument("Notes are limited to \(ClayverValidation.maxTextLength) characters.").localizedDescription
            return false
        }
        isAddingNote = true
        defer { isAddingNote = false }
        do {
            try await dataSource.addNote(conversationId: conversationId, text: text)
            return true
        } catch is CancellationError {
            return false
        } catch {
            alertMessage = ClayverAgentInboxViewModel.describe(error)
            return false
        }
    }

    /// Deletes an internal note (the author's own, or any for admins).
    public func deleteNote(_ noteId: String) async {
        let previous = notes
        notes.removeAll { $0.id == noteId }
        do {
            try await dataSource.deleteNote(conversationId: conversationId, noteId: noteId)
        } catch is CancellationError {
            notes = previous
        } catch {
            notes = previous
            alertMessage = ClayverAgentInboxViewModel.describe(error)
        }
    }

    // MARK: - Blocking

    /// Blocks the conversation's customer for `duration`.
    public func blockCustomer(reason: ClayverBlockStatus.Reason, duration: ClayverBlockDuration) async {
        guard let customerId = conversation?.customerId, !isUpdatingBlock else { return }
        isUpdatingBlock = true
        defer { isUpdatingBlock = false }
        let until = duration.interval.map { now().addingTimeInterval($0) }
        do {
            try await dataSource.blockCustomer(customerId: customerId, reason: reason, until: until)
            blockStatus = ClayverBlockStatus(reason: reason, until: until)
        } catch is CancellationError {
        } catch {
            alertMessage = ClayverAgentInboxViewModel.describe(error)
        }
    }

    /// Removes the customer's block.
    public func unblockCustomer() async {
        guard let customerId = conversation?.customerId, !isUpdatingBlock else { return }
        isUpdatingBlock = true
        defer { isUpdatingBlock = false }
        do {
            try await dataSource.unblockCustomer(customerId: customerId)
            blockStatus = nil
        } catch is CancellationError {
        } catch {
            alertMessage = ClayverAgentInboxViewModel.describe(error)
        }
    }

    // MARK: - Tags

    func applyServerTagIds(_ ids: [String]) {
        serverTagIds = ids
        rebuildTagIds()
    }

    private func rebuildTagIds() {
        tagIds = Self.effectiveTagIds(server: serverTagIds, changes: tagChanges)
    }

    /// The server's tag ids with the in-flight changes applied, sorted.
    static func effectiveTagIds(server: [String], changes: [String: Bool]) -> [String] {
        var ids = Set(server)
        for (id, adding) in changes {
            if adding { ids.insert(id) } else { ids.remove(id) }
        }
        return ids.sorted()
    }

    /// Adds the tag if the conversation does not have it, else removes it.
    public func toggleTag(_ tagId: String) async {
        await setTag(tagId, on: !hasTag(tagId))
    }

    /// Puts the tag on the conversation or takes it off. The change shows immediately and is
    /// reverted if the write fails.
    public func setTag(_ tagId: String, on: Bool) async {
        guard tagChanges[tagId] == nil else { return }
        tagChanges[tagId] = on
        rebuildTagIds()
        do {
            if on {
                try await dataSource.addTag(tagId, to: conversationId)
            } else {
                try await dataSource.removeTag(tagId, from: conversationId)
            }
            // Keep the local state until the live listener catches up.
            if on, !serverTagIds.contains(tagId) { serverTagIds.append(tagId) }
            if !on { serverTagIds.removeAll { $0 == tagId } }
        } catch is CancellationError {
        } catch {
            alertMessage = ClayverAgentInboxViewModel.describe(error)
        }
        tagChanges[tagId] = nil
        rebuildTagIds()
    }

    /// Creates a tag named `name` (or finds the existing one with the same slug) and puts it on
    /// the conversation.
    public func createAndAddTag(named name: String) async {
        do {
            let tag = try await dataSource.createTag(name: name, color: nil)
            if !allTags.contains(where: { $0.id == tag.id }) {
                allTags = ClayverTag.sortedByName(allTags + [tag])
            }
            await setTag(tag.id, on: true)
        } catch is CancellationError {
        } catch {
            alertMessage = ClayverAgentInboxViewModel.describe(error)
        }
    }

    // MARK: - Read state

    private func markReadIfNeeded() {
        guard isVisible, loadState == .loaded else { return }
        guard let latestIncoming = confirmed.values.filter(\.isFromCustomer).map(\.id).max() else { return }
        guard latestIncoming != lastMarkedReadId else { return }
        lastMarkedReadId = latestIncoming
        let dataSource = self.dataSource
        let conversationId = self.conversationId
        Task { [weak self] in
            do {
                try await dataSource.markConversationReadAsAgent(conversationId: conversationId)
            } catch {
                // Retry on the next update.
                if self?.lastMarkedReadId == latestIncoming { self?.lastMarkedReadId = nil }
            }
        }
    }

    // MARK: - Rows

    private func rebuildRows() {
        rows = ClayverThreadLayout.rows(
            confirmed: Array(confirmed.values),
            pending: pending,
            perspective: perspective,
            pendingSender: (id: agentUid ?? "", type: .agent),
            dividerBeforeId: dividerBeforeId,
            otherSideLastReadAt: customerLastReadAt,
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
}

extension ClayverAgentConversationViewModel: ClayverThreadModel {
    var perspective: ClayverMessagePerspective { .agent(myUid: agentUid, customerName: customerName) }
}
