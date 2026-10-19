import Foundation

/// Everything the chat UI needs from the backend. `ClayverChatViewModel` depends only on
/// this protocol, so it can be driven by a fake in tests and SwiftUI previews.
/// The SDK's implementation talks to Firebase (`Clayver.chatDataSource`).
public protocol ClayverChatDataSource {
    /// The conversation to open when none is given: newest open one, else newest of any status, else `nil`.
    func latestConversationId() async throws -> String?
    /// Live view of the newest `limit` messages, oldest first.
    func messages(conversationId: String, limit: Int) -> AsyncThrowingStream<[ClayverMessage], Error>
    /// Messages strictly older than the message with id `before`, oldest first.
    func loadOlderMessages(conversationId: String, before: String, limit: Int) async throws -> [ClayverMessage]
    /// Live `reads/{id}/agent/lastReadAt` (read receipts).
    func agentLastReadAt(conversationId: String) -> AsyncThrowingStream<Date?, Error>
    /// One-shot `reads/{id}/customer/lastReadAt`, used to place the "New messages" divider.
    func customerLastReadAt(conversationId: String) async throws -> Date?
    /// Sends a message, creating a conversation first when `conversationId` is `nil` and none is open.
    func sendMessage(text: String?, conversationId: String?, attachment: ClayverAttachmentInput?, clientMessageId: String) async throws -> ClayverMessage
    func markConversationRead(conversationId: String) async throws
    /// A download URL for an attachment.
    func attachmentURL(storagePath: String) async throws -> URL
    /// `config/public` of the workspace, if readable.
    func publicConfig() async throws -> ClayverPublicConfig?
    /// Live list of the customer's conversations, newest activity first (the conversation list).
    func conversations() -> AsyncThrowingStream<[ClayverConversation], Error>
    /// Sends a message in a conversation created for it (an empty chat's first message).
    func startConversation(text: String?, attachment: ClayverAttachmentInput?, clientMessageId: String) async throws -> ClayverMessage
    /// Live active block of the customer, or `nil`.
    func blockStatus() -> AsyncThrowingStream<ClayverBlockStatus?, Error>
}

/// Defaults for data sources written before multiple conversations: no list, never blocked,
/// and a first message that goes where `sendMessage(conversationId: nil)` puts it.
extension ClayverChatDataSource {
    public func conversations() -> AsyncThrowingStream<[ClayverConversation], Error> {
        AsyncThrowingStream { continuation in
            continuation.yield([])
            continuation.finish()
        }
    }

    public func startConversation(text: String?, attachment: ClayverAttachmentInput?, clientMessageId: String) async throws -> ClayverMessage {
        try await sendMessage(text: text, conversationId: nil, attachment: attachment, clientMessageId: clientMessageId)
    }

    public func blockStatus() -> AsyncThrowingStream<ClayverBlockStatus?, Error> {
        AsyncThrowingStream { continuation in
            continuation.yield(nil)
            continuation.finish()
        }
    }
}

/// Bridges a stream that can only be created once an async dependency resolves.
/// Cancelling the consumer cancels the inner iteration, which terminates the inner stream
/// and runs its `onTermination` (removing Firebase listeners).
func deferredStream<Source, Element>(
    resolve: @escaping @Sendable () async throws -> Source,
    make: @escaping (Source) -> AsyncThrowingStream<Element, Error>
) -> AsyncThrowingStream<Element, Error> {
    AsyncThrowingStream(Element.self, bufferingPolicy: .bufferingNewest(1)) { continuation in
        let task = Task {
            do {
                let source = try await resolve()
                try Task.checkCancellation()
                for try await value in make(source) {
                    continuation.yield(value)
                }
                continuation.finish()
            } catch {
                continuation.finish(throwing: clayverTranslate(error))
            }
        }
        continuation.onTermination = { _ in task.cancel() }
    }
}
