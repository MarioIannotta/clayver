import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Agent mode: support staff answering customers from the app that embeds the SDK.
///
/// The role comes from the verified ID token claim `clayver_roles[projectId]`. It only decides
/// what the UI offers; the database rules check `agents/{auth.uid}/active` on every operation.
/// Agent APIs throw `ClayverError.permissionDenied` early when the role is missing.
///
/// ```swift
/// if try await Clayver.isAgent() {
///     Clayver.openAgentInbox()
/// }
/// ```
extension Clayver {
    // MARK: - Role

    /// The signed-in user's role in the configured workspace, or `nil` for customers.
    /// Pass `forceRefresh: true` to pick up a grant or revocation made while the app runs
    /// (a new sign-in already refreshes the token). A refresh also updates the agent push
    /// registration.
    public static func agentRole(forceRefresh: Bool = false) async throws -> ClayverAgentRole? {
        try await run { try await $0.agentRole(forceRefresh: forceRefresh) }
    }

    /// Whether the signed-in user is an agent or admin of the configured workspace.
    public static func isAgent() async throws -> Bool {
        try await agentRole() != nil
    }

    // MARK: - Inbox & customers

    /// Live list of the workspace's conversations with `status`, newest activity first,
    /// at most `limit` of them. With a `tagId`, only conversations with that tag (read through
    /// `tagIndex/{tagId}`). The Firebase listeners are removed when iteration stops.
    public static func agentConversations(
        status: ClayverConversationStatus = .open,
        limit: Int = 50,
        tagId: String? = nil
    ) -> AsyncThrowingStream<[ClayverAgentConversation], Error> {
        deferredStream(resolve: { try await requireClient() }) { $0.agentConversations(status: status, limit: limit, tagId: tagId) }
    }

    /// Live profile of a customer (`users/{customerId}`).
    public static func customerProfile(customerId: String) -> AsyncThrowingStream<ClayverCustomerProfile, Error> {
        deferredStream(resolve: { try await requireClient() }) { $0.customerProfile(customerId: customerId) }
    }

    // MARK: - Tags

    /// Live tag catalog of the workspace (`tags`), by name.
    public static func tags() -> AsyncThrowingStream<[ClayverTag], Error> {
        deferredStream(resolve: { try await requireClient() }) { $0.tags() }
    }

    /// Creates a tag whose id is the slug of `name` (see `ClayverTagRules.slug(_:)`), or returns
    /// the existing tag with that id. Without a `color` (`#rrggbb`), the palette color of the
    /// slug is used.
    @discardableResult
    public static func createTag(name: String, color: String? = nil) async throws -> ClayverTag {
        try await run { try await $0.createTag(name: name, color: color) }
    }

    /// Live ids of the tags on a conversation (`conversationTags/{id}`).
    public static func conversationTags(conversationId: String) -> AsyncThrowingStream<[String], Error> {
        deferredStream(resolve: { try await requireClient() }) { $0.conversationTags(conversationId: conversationId) }
    }

    /// Puts the tag `tagId` on a conversation. The tag must exist (`createTag`).
    public static func addTag(_ tagId: String, to conversationId: String) async throws {
        try await run { try await $0.addTag(tagId, to: conversationId) }
    }

    /// Takes the tag `tagId` off a conversation.
    public static func removeTag(_ tagId: String, from conversationId: String) async throws {
        try await run { try await $0.removeTag(tagId, from: conversationId) }
    }

    // MARK: - Replying

    /// Sends a reply as the signed-in agent (`senderType: "agent"`, `senderId: auth.uid`,
    /// `senderName` from `agents/{uid}/displayName`). Attachments must be images; they are
    /// re-encoded as JPEG of at most 300 KB and stored under the conversation's customer.
    @discardableResult
    public static func sendAgentReply(conversationId: String, text: String? = nil, attachment: ClayverAttachmentInput? = nil) async throws -> ClayverMessage {
        try await run { try await $0.sendAgentReply(conversationId: conversationId, text: text, attachment: attachment) }
    }

    /// Opens or closes a conversation.
    public static func setConversationStatus(_ conversationId: String, _ status: ClayverConversationStatus) async throws {
        try await run { try await $0.setConversationStatus(conversationId, status: status) }
    }

    /// Assigns the conversation to the signed-in agent (`toMe: true`) or removes the assignee.
    public static func assignConversation(_ conversationId: String, toMe: Bool) async throws {
        try await run { try await $0.assignConversation(conversationId, toMe: toMe) }
    }

    /// Writes the shared team read marker `reads/{id}/agent`.
    public static func markConversationReadAsAgent(_ conversationId: String) async throws {
        try await run { try await $0.markConversationReadAsAgent(conversationId) }
    }

    // MARK: - Priority & status

    /// Live priority and status of a conversation (`triage/{id}`, agents only; customers never
    /// see it). Values are option ids from `triageOptionsUpdates()`.
    public static func triageUpdates(conversationId: String) -> AsyncThrowingStream<ClayverTriage, Error> {
        deferredStream(resolve: { try await requireClient() }) { $0.triageUpdates(conversationId: conversationId) }
    }

    /// Live priority and status lists of the workspace (`triageOptions`), edited in the
    /// dashboard's Settings. A list that was never saved yields the defaults.
    public static func triageOptionsUpdates() -> AsyncThrowingStream<ClayverTriageOptions, Error> {
        deferredStream(resolve: { try await requireClient() }) { $0.triageOptionsUpdates() }
    }

    /// Sets the priority of a conversation to an option id of the priority list, or clears it.
    public static func setConversationPriority(_ conversationId: String, _ optionId: String?) async throws {
        try await run { try await $0.setTriage(conversationId, kind: .priority, optionId: optionId) }
    }

    /// Sets the status ("stage") of a conversation to an option id of the status list, or
    /// clears it. Not the same as open/closed (`setConversationStatus`).
    public static func setConversationStage(_ conversationId: String, _ optionId: String?) async throws {
        try await run { try await $0.setTriage(conversationId, kind: .stage, optionId: optionId) }
    }

    // MARK: - Internal notes

    /// Live internal notes of a conversation, newest first. Customers never see them.
    public static func notes(conversationId: String) -> AsyncThrowingStream<[ClayverInternalNote], Error> {
        deferredStream(resolve: { try await requireClient() }) { $0.notes(conversationId: conversationId) }
    }

    /// Adds an internal note (1-4000 characters) as the signed-in agent. Returns the note id.
    @discardableResult
    public static func addNote(_ conversationId: String, text: String) async throws -> String {
        try await run { try await $0.addNote(conversationId, text: text) }
    }

    /// Deletes an internal note. Allowed for its author and for admins.
    public static func deleteNote(_ conversationId: String, noteId: String) async throws {
        try await run { try await $0.deleteNote(conversationId, noteId: noteId) }
    }

    // MARK: - Customer history & blocking

    /// Live list of all conversations of a customer, open and closed, newest activity first.
    public static func customerConversations(customerId: String) -> AsyncThrowingStream<[ClayverAgentConversation], Error> {
        deferredStream(resolve: { try await requireClient() }) { $0.customerConversations(customerId: customerId) }
    }

    /// Live active block of a customer (`moderation/{customerId}`), or `nil`.
    public static func customerBlockStatus(customerId: String) -> AsyncThrowingStream<ClayverBlockStatus?, Error> {
        deferredStream(resolve: { try await requireClient() }) { $0.customerBlockStatus(customerId: customerId) }
    }

    /// Blocks a customer from starting conversations and sending messages. `until == nil`
    /// lasts until an agent unblocks; `.rateLimit` is reserved for automatic blocks.
    public static func blockCustomer(_ customerId: String, reason: ClayverBlockStatus.Reason, until: Date? = nil) async throws {
        try await run { try await $0.blockCustomer(customerId, reason: reason, until: until) }
    }

    /// Removes a customer's block.
    public static func unblockCustomer(_ customerId: String) async throws {
        try await run { try await $0.unblockCustomer(customerId) }
    }

    /// The data source behind `ClayverAgentInboxView` and `ClayverAgentConversationView`.
    public static var agentDataSource: ClayverAgentDataSource {
        FirebaseAgentDataSource(resolve: { try await requireClient() })
    }

    // MARK: - UI

    #if canImport(UIKit)
    /// Presents the agent inbox modally from `viewController`, or from the top-most view
    /// controller. With a `conversationId`, the inbox opens straight into that conversation.
    @available(iOSApplicationExtension, unavailable)
    @MainActor
    public static func openAgentInbox(conversationId: String? = nil, from viewController: UIViewController? = nil) {
        ClayverPresenter.presentAgentInbox(conversationId: conversationId, from: viewController)
    }
    #endif
}
