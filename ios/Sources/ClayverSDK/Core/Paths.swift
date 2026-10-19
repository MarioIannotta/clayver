import Foundation

/// Realtime Database and Storage paths from `firebase/database.schema.md`.
struct ClayverPaths: Equatable, Sendable {
    let projectId: String

    var root: String { "clayver/projects/\(projectId)" }

    var conversations: String { "\(root)/conversations" }
    func conversation(_ id: String) -> String { "\(conversations)/\(id)" }
    func messages(_ conversationId: String) -> String { "\(root)/messages/\(conversationId)" }

    func customerRead(_ conversationId: String) -> String { "\(root)/reads/\(conversationId)/customer" }
    func agentRead(_ conversationId: String) -> String { "\(root)/reads/\(conversationId)/agent" }

    func inbox(_ cid: String) -> String { "\(root)/inbox/\(cid)" }
    func inboxUnreadTotal(_ cid: String) -> String { "\(inbox(cid))/unreadTotal" }
    func inboxConversations(_ cid: String) -> String { "\(inbox(cid))/conversations" }

    func user(_ cid: String) -> String { "\(root)/users/\(cid)" }
    func userProperties(_ cid: String) -> String { "\(user(cid))/properties" }
    func customerDevice(_ cid: String, deviceId: String) -> String { "\(root)/devices/customers/\(cid)/\(deviceId)" }
    func agentDevice(_ uid: String, deviceId: String) -> String { "\(root)/devices/agents/\(uid)/\(deviceId)" }

    func agent(_ uid: String) -> String { "\(root)/agents/\(uid)" }

    func moderation(_ cid: String) -> String { "\(root)/moderation/\(cid)" }

    var tags: String { "\(root)/tags" }
    func tag(_ tagId: String) -> String { "\(tags)/\(tagId)" }
    func conversationTags(_ conversationId: String) -> String { "\(root)/conversationTags/\(conversationId)" }
    func conversationTag(_ conversationId: String, tagId: String) -> String { "\(conversationTags(conversationId))/\(tagId)" }
    func tagIndex(_ tagId: String) -> String { "\(root)/tagIndex/\(tagId)" }

    func triage(_ conversationId: String) -> String { "\(root)/triage/\(conversationId)" }
    var triageOptions: String { "\(root)/triageOptions" }
    func notes(_ conversationId: String) -> String { "\(root)/notes/\(conversationId)" }
    func note(_ conversationId: String, noteId: String) -> String { "\(notes(conversationId))/\(noteId)" }
    var agents: String { "\(root)/agents" }

    var publicConfig: String { "\(root)/config/public" }

    /// `clayver/projects/{projectId}/customers/{customerId}/conversations/{conversationId}/{attachmentId}/{fileName}`
    func attachment(customerId: String, conversationId: String, attachmentId: String, fileName: String) -> String {
        "\(root)/customers/\(customerId)/conversations/\(conversationId)/\(attachmentId)/\(fileName)"
    }
}
