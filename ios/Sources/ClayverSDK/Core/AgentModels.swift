import Foundation

/// The support role of the signed-in Firebase user in the configured workspace, read from the
/// verified ID token claim `clayver_roles[projectId]`.
///
/// The claim only decides what the UI shows. The database rules check
/// `agents/{auth.uid}/active` on every read and write, so a stale claim opens nothing.
public enum ClayverAgentRole: String, Sendable, CaseIterable {
    case admin
    case agent

    /// Name of the custom claim holding `{ [projectId]: "admin" | "agent" }`.
    public static let claimName = "clayver_roles"

    /// The role for `projectId` in an ID token's claims, or `nil` when the claim is missing,
    /// malformed, or names another workspace only.
    public static func fromClaims(_ claims: [String: Any], projectId: String) -> ClayverAgentRole? {
        guard let roles = claims[claimName] as? [String: Any],
              let raw = roles[projectId] as? String else { return nil }
        return ClayverAgentRole(rawValue: raw)
    }

    public var isAdmin: Bool { self == .admin }
}

/// Status of a conversation, as used by the agent APIs (`.open` or `.closed`).
public typealias ClayverConversationStatus = ClayverConversation.Status

/// A conversation as seen by the support team (`conversations/{id}`).
public struct ClayverAgentConversation: Identifiable, Equatable, Hashable, Sendable {
    public let id: String
    public let customerId: String
    public let status: ClayverConversationStatus
    public let createdAt: Date?
    public let updatedAt: Date?
    public let lastMessage: ClayverConversation.LastMessage?
    /// Customer messages the team has not read yet (`unread.agent`).
    public let unreadForAgents: Int
    /// The agent the conversation is assigned to, if any.
    public let assigneeUid: String?

    public init(
        id: String,
        customerId: String,
        status: ClayverConversationStatus,
        createdAt: Date?,
        updatedAt: Date?,
        lastMessage: ClayverConversation.LastMessage?,
        unreadForAgents: Int,
        assigneeUid: String?
    ) {
        self.id = id
        self.customerId = customerId
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.lastMessage = lastMessage
        self.unreadForAgents = unreadForAgents
        self.assigneeUid = assigneeUid
    }

    /// Time of the latest activity: `updatedAt`, else the last message, else `createdAt`.
    public var lastActivityAt: Date? { updatedAt ?? lastMessage?.createdAt ?? createdAt }

    func with(status: ClayverConversationStatus) -> ClayverAgentConversation {
        ClayverAgentConversation(id: id, customerId: customerId, status: status, createdAt: createdAt, updatedAt: updatedAt,
                                 lastMessage: lastMessage, unreadForAgents: unreadForAgents, assigneeUid: assigneeUid)
    }

    func with(assigneeUid: String?) -> ClayverAgentConversation {
        ClayverAgentConversation(id: id, customerId: customerId, status: status, createdAt: createdAt, updatedAt: updatedAt,
                                 lastMessage: lastMessage, unreadForAgents: unreadForAgents, assigneeUid: assigneeUid)
    }
}

/// A tag of the workspace catalog (`tags/{tagId}`). Agents put tags on conversations
/// (`conversationTags`); customers never see them.
public struct ClayverTag: Identifiable, Equatable, Hashable, Sendable {
    /// The slug of the name at creation time (see `ClayverTagRules.slug(_:)`). Renaming keeps it.
    public let id: String
    public let name: String
    /// `#rrggbb`.
    public let color: String

    public init(id: String, name: String, color: String) {
        self.id = id
        self.name = name
        self.color = color
    }

    /// Tags by name (case-insensitive), then id.
    public static func sortedByName(_ tags: [ClayverTag]) -> [ClayverTag] {
        tags.sorted { lhs, rhs in
            switch lhs.name.localizedCaseInsensitiveCompare(rhs.name) {
            case .orderedAscending: return true
            case .orderedDescending: return false
            case .orderedSame: return lhs.id < rhs.id
            }
        }
    }
}

/// The customer's Firebase Auth account (`users/{customerId}/account`, written by the functions
/// when the customer starts a conversation). The customer id is the Firebase uid.
public struct ClayverCustomerAccount: Equatable, Sendable {
    /// `true` for an anonymous visitor (no sign-in provider).
    public let anonymous: Bool
    public let email: String?
    public let emailVerified: Bool
    public let displayName: String?

    public init(anonymous: Bool, email: String?, emailVerified: Bool, displayName: String?) {
        self.anonymous = anonymous
        self.email = email
        self.emailVerified = emailVerified
        self.displayName = displayName
    }
}

/// What the team knows about a customer (`users/{customerId}`).
public struct ClayverCustomerProfile: Equatable, Sendable {
    public let customerId: String
    /// The customer's Firebase Auth account, once a conversation recorded it.
    public let account: ClayverCustomerAccount?
    /// Properties set with `Clayver.setUserProperties`.
    public let properties: [String: ClayverValue]
    public let lastSeenAt: Date?

    public init(customerId: String, account: ClayverCustomerAccount?, properties: [String: ClayverValue], lastSeenAt: Date?) {
        self.customerId = customerId
        self.account = account
        self.properties = properties
        self.lastSeenAt = lastSeenAt
    }

    /// The `Clayver.UserProperty.name` property, else the account's name or email, else a short
    /// form of the customer id.
    public var displayName: String { Self.displayName(customerId: customerId, profile: self) }

    /// The `Clayver.UserProperty.email` property, else the account's email.
    public var email: String? {
        if case .string(let email)? = properties[Clayver.UserProperty.email], !email.isEmpty { return email }
        return account?.email
    }

    /// The `Clayver.UserProperty.uid` property: the host app's own id for the user.
    public var userId: String? {
        if case .string(let id)? = properties[Clayver.UserProperty.uid], !id.isEmpty { return id }
        return nil
    }

    /// Properties other than the `Clayver.UserProperty` keys.
    public var customProperties: [String: ClayverValue] {
        properties.filter { !Clayver.UserProperty.all.contains($0.key) }
    }

    /// Display name for a customer whose profile may not be loaded yet.
    public static func displayName(customerId: String, profile: ClayverCustomerProfile?) -> String {
        if case .string(let name)? = profile?.properties[Clayver.UserProperty.name] {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        for candidate in [profile?.account?.displayName, profile?.account?.email] {
            if let value = candidate?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty { return value }
        }
        return shortId(customerId)
    }

    /// The first 8 characters of the id.
    static func shortId(_ customerId: String) -> String {
        guard !customerId.isEmpty else { return "Customer" }
        return String(customerId.prefix(8))
    }
}

extension ClayverValue {
    /// The value as shown in the customer info sheet.
    public var displayString: String {
        switch self {
        case .string(let value): return value
        case .int(let value): return String(value)
        case .double(let value):
            return value.rounded() == value && abs(value) < 1e15 ? String(Int(value)) : String(value)
        case .bool(let value): return value ? "true" : "false"
        }
    }
}

/// One entry of a workspace triage list (`triageOptions/{priority|stage}/{optionId}`).
public struct ClayverTriageOption: Identifiable, Equatable, Hashable, Sendable {
    /// The two triage lists. `stage` is shown to people as "Status".
    public enum Kind: String, Sendable, CaseIterable {
        case priority
        case stage
    }

    /// `^[a-z0-9][a-z0-9_-]{0,39}$`.
    public let id: String
    public let name: String
    /// `#rrggbb`.
    public let color: String
    /// Position in the list (ascending).
    public let order: Double

    public init(id: String, name: String, color: String, order: Double) {
        self.id = id
        self.name = name
        self.color = color
        self.order = order
    }

    /// The list used while `triageOptions/{kind}` has never been saved.
    public static func defaults(for kind: Kind) -> [ClayverTriageOption] {
        switch kind {
        case .priority:
            return [
                ClayverTriageOption(id: "high", name: "High", color: "#DC2626", order: 0),
                ClayverTriageOption(id: "medium", name: "Medium", color: "#D97706", order: 1),
                ClayverTriageOption(id: "low", name: "Low", color: "#64748B", order: 2),
            ]
        case .stage:
            return [
                ClayverTriageOption(id: "todo", name: "To do", color: "#2563EB", order: 0),
                ClayverTriageOption(id: "in_progress", name: "In progress", color: "#7C3AED", order: 1),
                ClayverTriageOption(id: "on_hold", name: "On hold", color: "#64748B", order: 2),
            ]
        }
    }

    /// Options by `order`, then name, then id.
    public static func sorted(_ options: [ClayverTriageOption]) -> [ClayverTriageOption] {
        options.sorted { lhs, rhs in
            if lhs.order != rhs.order { return lhs.order < rhs.order }
            switch lhs.name.localizedCaseInsensitiveCompare(rhs.name) {
            case .orderedAscending: return true
            case .orderedDescending: return false
            case .orderedSame: return lhs.id < rhs.id
            }
        }
    }
}

/// The workspace's priority and status lists (`triageOptions`), each falling back to the
/// defaults while it has never been saved.
public struct ClayverTriageOptions: Equatable, Sendable {
    public let priority: [ClayverTriageOption]
    public let stage: [ClayverTriageOption]

    public init(priority: [ClayverTriageOption], stage: [ClayverTriageOption]) {
        self.priority = priority
        self.stage = stage
    }

    public static let defaults = ClayverTriageOptions(
        priority: ClayverTriageOption.defaults(for: .priority),
        stage: ClayverTriageOption.defaults(for: .stage)
    )

    public func options(_ kind: ClayverTriageOption.Kind) -> [ClayverTriageOption] {
        kind == .priority ? priority : stage
    }

    /// The option with `id` in the list, or `nil` (unset, or an option that was removed).
    public func option(_ kind: ClayverTriageOption.Kind, id: String?) -> ClayverTriageOption? {
        guard let id else { return nil }
        return options(kind).first { $0.id == id }
    }
}

/// Priority and status of a conversation (`triage/{conversationId}`), agents only. Values are
/// option ids; look them up with `ClayverTriageOptions.option(_:id:)`.
public struct ClayverTriage: Equatable, Hashable, Sendable {
    public let priority: String?
    /// Shown to people as "Status".
    public let stage: String?

    public init(priority: String?, stage: String?) {
        self.priority = priority
        self.stage = stage
    }

    public static let none = ClayverTriage(priority: nil, stage: nil)

    public func value(_ kind: ClayverTriageOption.Kind) -> String? {
        kind == .priority ? priority : stage
    }

    func with(_ kind: ClayverTriageOption.Kind, _ value: String?) -> ClayverTriage {
        kind == .priority ? ClayverTriage(priority: value, stage: stage) : ClayverTriage(priority: priority, stage: value)
    }
}

/// An internal note on a conversation (`notes/{conversationId}/{noteId}`). Agents only, never
/// shown to the customer. Immutable; the author or an admin can delete it.
public struct ClayverInternalNote: Identifiable, Equatable, Hashable, Sendable {
    public let id: String
    public let conversationId: String
    public let authorUid: String
    public let authorName: String?
    public let text: String
    public let createdAt: Date?

    public init(id: String, conversationId: String, authorUid: String, authorName: String?, text: String, createdAt: Date?) {
        self.id = id
        self.conversationId = conversationId
        self.authorUid = authorUid
        self.authorName = authorName
        self.text = text
        self.createdAt = createdAt
    }
}

/// How long a block set from the agent UI lasts.
public enum ClayverBlockDuration: String, Sendable, CaseIterable, Identifiable {
    case oneHour
    case oneDay
    case oneWeek
    case permanent

    public var id: String { rawValue }

    /// The block's length, or `nil` for a block that lasts until an agent removes it.
    public var interval: TimeInterval? {
        switch self {
        case .oneHour: return 3_600
        case .oneDay: return 86_400
        case .oneWeek: return 7 * 86_400
        case .permanent: return nil
        }
    }

    public var label: String {
        switch self {
        case .oneHour: return "1 hour"
        case .oneDay: return "24 hours"
        case .oneWeek: return "7 days"
        case .permanent: return "Until unblocked"
        }
    }
}
