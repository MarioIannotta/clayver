import Foundation

/// Everything the agent UI (`ClayverAgentInboxView`, `ClayverAgentConversationView`) needs from
/// the backend. The view models depend only on this protocol, so they can be driven by a fake
/// in tests and previews. The SDK's implementation talks to Firebase (`Clayver.agentDataSource`).
///
/// Implementations throw `ClayverError.permissionDenied` when the signed-in user is not an
/// agent of the workspace.
public protocol ClayverAgentDataSource {
    /// The Firebase uid of the signed-in agent. Throws `permissionDenied` without an agent role.
    func currentAgentUid() async throws -> String
    /// Live list of conversations with `status`, newest activity first.
    func agentConversations(status: ClayverConversationStatus, limit: Int) -> AsyncThrowingStream<[ClayverAgentConversation], Error>
    /// Live `conversations/{id}` (`nil` while it does not exist).
    func conversation(id: String) -> AsyncThrowingStream<ClayverAgentConversation?, Error>
    /// Live `users/{customerId}`.
    func customerProfile(customerId: String) -> AsyncThrowingStream<ClayverCustomerProfile, Error>
    /// One-shot `users/{customerId}`, used for inbox row names.
    func fetchCustomerProfile(customerId: String) async throws -> ClayverCustomerProfile
    /// Live view of the newest `limit` messages, oldest first.
    func messages(conversationId: String, limit: Int) -> AsyncThrowingStream<[ClayverMessage], Error>
    /// Messages strictly older than the message with id `before`, oldest first.
    func loadOlderMessages(conversationId: String, before: String, limit: Int) async throws -> [ClayverMessage]
    /// Live `reads/{id}/customer/lastReadAt` ("Seen" receipts on team messages).
    func customerLastReadAt(conversationId: String) -> AsyncThrowingStream<Date?, Error>
    /// One-shot `reads/{id}/agent/lastReadAt`, used to place the "New messages" divider.
    func agentLastReadAt(conversationId: String) async throws -> Date?
    /// Sends a reply as the signed-in agent.
    func sendAgentReply(conversationId: String, text: String?, attachment: ClayverAttachmentInput?, clientMessageId: String) async throws -> ClayverMessage
    func setConversationStatus(conversationId: String, status: ClayverConversationStatus) async throws
    /// Assigns the conversation to the signed-in agent, or removes the assignee.
    func assignConversation(conversationId: String, toMe: Bool) async throws
    /// Writes the shared team read marker `reads/{id}/agent`.
    func markConversationReadAsAgent(conversationId: String) async throws
    /// A download URL for an attachment.
    func attachmentURL(storagePath: String) async throws -> URL
    /// Live list of conversations with `status` that carry the tag `tagId` (all of them when
    /// `nil`), newest activity first.
    func agentConversations(status: ClayverConversationStatus, limit: Int, tagId: String?) -> AsyncThrowingStream<[ClayverAgentConversation], Error>
    /// Live tag catalog (`tags`), by name.
    func tags() -> AsyncThrowingStream<[ClayverTag], Error>
    /// Live ids of the tags on a conversation (`conversationTags/{id}`).
    func conversationTags(conversationId: String) -> AsyncThrowingStream<[String], Error>
    /// Creates a tag, or returns the existing tag with the same slug.
    func createTag(name: String, color: String?) async throws -> ClayverTag
    func addTag(_ tagId: String, to conversationId: String) async throws
    func removeTag(_ tagId: String, from conversationId: String) async throws
    /// Live priority and status of a conversation (`triage/{id}`).
    func triage(conversationId: String) -> AsyncThrowingStream<ClayverTriage, Error>
    /// Live priority and status lists (`triageOptions`), with the defaults for unsaved lists.
    func triageOptions() -> AsyncThrowingStream<ClayverTriageOptions, Error>
    /// Sets the priority or status of a conversation to an option id, or clears it (`nil`).
    func setTriage(conversationId: String, kind: ClayverTriageOption.Kind, optionId: String?) async throws
    /// Live internal notes of a conversation (`notes/{id}`), newest first.
    func notes(conversationId: String) -> AsyncThrowingStream<[ClayverInternalNote], Error>
    /// Adds an internal note as the signed-in agent.
    func addNote(conversationId: String, text: String) async throws
    /// Deletes an internal note (the author or an admin).
    func deleteNote(conversationId: String, noteId: String) async throws
    /// Live list of all conversations of a customer, newest activity first.
    func customerConversations(customerId: String) -> AsyncThrowingStream<[ClayverAgentConversation], Error>
    /// Live active block of a customer (`moderation/{customerId}`), or `nil`.
    func customerBlockStatus(customerId: String) -> AsyncThrowingStream<ClayverBlockStatus?, Error>
    /// Blocks a customer from writing. `until == nil` blocks until an agent unblocks.
    func blockCustomer(customerId: String, reason: ClayverBlockStatus.Reason, until: Date?) async throws
    /// Removes a customer's block.
    func unblockCustomer(customerId: String) async throws
    /// Live display names of the team (`agents`), by uid.
    func agentNames() -> AsyncThrowingStream<[String: String], Error>
}

/// Defaults for data sources written before tags: an empty catalog, and tag writes that fail.
extension ClayverAgentDataSource {
    public func agentConversations(status: ClayverConversationStatus, limit: Int, tagId: String?) -> AsyncThrowingStream<[ClayverAgentConversation], Error> {
        guard tagId != nil else { return agentConversations(status: status, limit: limit) }
        return AsyncThrowingStream { $0.finish(throwing: ClayverError.invalidArgument("This data source does not support tags.")) }
    }

    public func tags() -> AsyncThrowingStream<[ClayverTag], Error> {
        AsyncThrowingStream { continuation in
            continuation.yield([])
            continuation.finish()
        }
    }

    public func conversationTags(conversationId: String) -> AsyncThrowingStream<[String], Error> {
        AsyncThrowingStream { continuation in
            continuation.yield([])
            continuation.finish()
        }
    }

    public func createTag(name: String, color: String?) async throws -> ClayverTag {
        throw ClayverError.invalidArgument("This data source does not support tags.")
    }

    public func addTag(_ tagId: String, to conversationId: String) async throws {
        throw ClayverError.invalidArgument("This data source does not support tags.")
    }

    public func removeTag(_ tagId: String, from conversationId: String) async throws {
        throw ClayverError.invalidArgument("This data source does not support tags.")
    }
}

/// Defaults for data sources written before triage, notes, customer history and blocking:
/// empty or default values, and writes that fail.
extension ClayverAgentDataSource {
    private func single<T>(_ value: T) -> AsyncThrowingStream<T, Error> {
        AsyncThrowingStream { continuation in
            continuation.yield(value)
            continuation.finish()
        }
    }

    private func unsupported(_ feature: String) -> ClayverError {
        ClayverError.invalidArgument("This data source does not support \(feature).")
    }

    public func triage(conversationId: String) -> AsyncThrowingStream<ClayverTriage, Error> { single(ClayverTriage.none) }

    public func triageOptions() -> AsyncThrowingStream<ClayverTriageOptions, Error> { single(ClayverTriageOptions.defaults) }

    public func setTriage(conversationId: String, kind: ClayverTriageOption.Kind, optionId: String?) async throws {
        throw unsupported("priority and status")
    }

    public func notes(conversationId: String) -> AsyncThrowingStream<[ClayverInternalNote], Error> { single([]) }

    public func addNote(conversationId: String, text: String) async throws { throw unsupported("notes") }

    public func deleteNote(conversationId: String, noteId: String) async throws { throw unsupported("notes") }

    public func customerConversations(customerId: String) -> AsyncThrowingStream<[ClayverAgentConversation], Error> { single([]) }

    public func customerBlockStatus(customerId: String) -> AsyncThrowingStream<ClayverBlockStatus?, Error> { single(nil) }

    public func blockCustomer(customerId: String, reason: ClayverBlockStatus.Reason, until: Date?) async throws {
        throw unsupported("blocking")
    }

    public func unblockCustomer(customerId: String) async throws { throw unsupported("blocking") }

    public func agentNames() -> AsyncThrowingStream<[String: String], Error> { single([:]) }
}
