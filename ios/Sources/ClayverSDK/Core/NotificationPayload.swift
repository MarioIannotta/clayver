import Foundation

/// The `data` block of a Clayver push, see "Push notification payload" in the schema.
///
/// ```json
/// { "clayver": "1", "type": "message", "audience": "customer", "projectId": "default",
///   "conversationId": "-Nx...", "messageId": "-Ny...", "link": "clayver://conversation/-Nx..." }
/// ```
public struct ClayverNotificationPayload: Equatable, Sendable {
    /// Who the push was sent to. Unknown or missing values are treated as `.customer`.
    public enum Audience: String, Sendable {
        /// A customer's device: opens the customer chat.
        case customer
        /// An agent's device (`devices/agents/{uid}`): opens the agent conversation view.
        case agent
    }

    public let type: String
    public let audience: Audience
    public let projectId: String?
    public let conversationId: String
    public let messageId: String?
    public let link: URL?

    public init(type: String, projectId: String?, conversationId: String, messageId: String?, link: URL?, audience: Audience = .customer) {
        self.type = type
        self.audience = audience
        self.projectId = projectId
        self.conversationId = conversationId
        self.messageId = messageId
        self.link = link
    }

    /// Whether `userInfo` carries the Clayver marker (`"clayver": "1"`).
    public static func isClayver(_ userInfo: [AnyHashable: Any]) -> Bool {
        let fields = flatten(userInfo)
        return fields["clayver"] == "1"
    }

    /// Parses a notification's `userInfo`. Returns `nil` for non-Clayver pushes
    /// or payloads without a conversation id.
    public init?(userInfo: [AnyHashable: Any]) {
        let fields = Self.flatten(userInfo)
        guard fields["clayver"] == "1" else { return nil }
        let link = fields["link"].flatMap(URL.init(string:))
        let conversationId = fields["conversationId"].flatMap { $0.isEmpty ? nil : $0 }
            ?? link.flatMap(Self.conversationId(fromLink:))
        guard let conversationId, ClayverValidation.isValidDatabaseKey(conversationId) else { return nil }
        self.type = fields["type"] ?? "message"
        self.audience = fields["audience"].flatMap { Audience(rawValue: $0.lowercased()) } ?? .customer
        self.projectId = fields["projectId"]
        self.conversationId = conversationId
        self.messageId = fields["messageId"]
        self.link = link
    }

    /// Extracts the id from `clayver://conversation/{id}`.
    public static func conversationId(fromLink url: URL) -> String? {
        guard url.scheme?.lowercased() == "clayver", url.host?.lowercased() == "conversation" else { return nil }
        let id = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return id.isEmpty ? nil : id
    }

    /// FCM puts data keys at the top level of `userInfo` as strings. Some relays nest
    /// them under `data`; numbers may arrive as `NSNumber`. Normalise all of that.
    private static func flatten(_ userInfo: [AnyHashable: Any]) -> [String: String] {
        var result: [String: String] = [:]
        func absorb(_ dict: [AnyHashable: Any]) {
            for (key, value) in dict {
                guard let key = key as? String else { continue }
                if let string = value as? String {
                    result[key] = string
                } else if let number = value as? NSNumber {
                    result[key] = number.stringValue
                }
            }
        }
        if let nested = userInfo["data"] as? [AnyHashable: Any] { absorb(nested) }
        absorb(userInfo)
        return result
    }
}

/// What tapping a Clayver push opens. Pure, so routing can be tested without UIKit.
enum ClayverNotificationRoute: Equatable {
    case customerChat(conversationId: String)
    case agentConversation(conversationId: String)
    /// A push for another workspace.
    case ignore

    /// - Parameter configuredProjectId: The configured workspace; `nil` skips the workspace check.
    static func route(for payload: ClayverNotificationPayload, configuredProjectId: String?) -> ClayverNotificationRoute {
        if let projectId = payload.projectId, let configuredProjectId, projectId != configuredProjectId {
            return .ignore
        }
        switch payload.audience {
        case .agent: return .agentConversation(conversationId: payload.conversationId)
        case .customer: return .customerChat(conversationId: payload.conversationId)
        }
    }
}
