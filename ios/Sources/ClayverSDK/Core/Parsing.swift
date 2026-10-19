import Foundation

/// Converts raw Realtime Database values (as delivered by `DataSnapshot.value`)
/// into models. Pure so it can be tested without Firebase.
enum ClayverParsing {
    /// Server timestamps are milliseconds since the epoch.
    static func date(_ value: Any?) -> Date? {
        guard let number = value as? NSNumber else { return nil }
        return Date(timeIntervalSince1970: number.doubleValue / 1000)
    }

    static func int(_ value: Any?) -> Int? {
        (value as? NSNumber)?.intValue
    }

    static func string(_ value: Any?) -> String? {
        value as? String
    }

    static func bool(_ value: Any?) -> Bool? {
        (value as? NSNumber)?.boolValue
    }

    static func attachment(_ value: Any?) -> ClayverAttachment? {
        guard let dict = value as? [String: Any],
              let storagePath = dict["storagePath"] as? String,
              let fileName = dict["fileName"] as? String,
              let contentType = dict["contentType"] as? String else { return nil }
        return ClayverAttachment(
            storagePath: storagePath,
            fileName: fileName,
            contentType: contentType,
            size: int(dict["size"]) ?? 0,
            width: int(dict["width"]),
            height: int(dict["height"])
        )
    }

    static func message(id: String, conversationId: String, value: Any?) -> ClayverMessage? {
        guard let dict = value as? [String: Any] else { return nil }
        let text = string(dict["text"])
        let attachment = attachment(dict["attachment"])
        guard text != nil || attachment != nil else { return nil }
        return ClayverMessage(
            id: id,
            conversationId: conversationId,
            senderId: string(dict["senderId"]) ?? "",
            senderType: string(dict["senderType"]).flatMap(ClayverMessage.SenderType.init(rawValue:)) ?? .unknown,
            senderName: string(dict["senderName"]),
            text: text,
            attachment: attachment,
            createdAt: date(dict["createdAt"]) ?? Date(timeIntervalSince1970: 0),
            clientMessageId: string(dict["clientMessageId"])
        )
    }

    /// Parses `messages/{conversationId}` children, sorted chronologically (push ids sort by time).
    static func messages(conversationId: String, children: [(key: String, value: Any?)]) -> [ClayverMessage] {
        children
            .compactMap { message(id: $0.key, conversationId: conversationId, value: $0.value) }
            .sorted { $0.id < $1.id }
    }

    static func conversation(id: String, value: Any?) -> ClayverConversation? {
        guard let dict = value as? [String: Any] else { return nil }
        let unread = (dict["unread"] as? [String: Any]).flatMap { int($0["customer"]) } ?? 0
        return ClayverConversation(
            id: id,
            status: string(dict["status"]).flatMap(ClayverConversation.Status.init(rawValue:)) ?? .unknown,
            createdAt: date(dict["createdAt"]),
            updatedAt: date(dict["updatedAt"]),
            lastMessage: lastMessage(dict["lastMessage"]),
            unreadCount: unread
        )
    }

    /// Parses `inbox/{cid}/conversations`, newest activity first.
    static func conversations(_ value: Any?) -> [ClayverConversation] {
        guard let dict = value as? [String: Any] else { return [] }
        return dict
            .compactMap { conversation(id: $0.key, value: $0.value) }
            .sorted { lhs, rhs in
                let l = lhs.updatedAt ?? lhs.createdAt ?? .distantPast
                let r = rhs.updatedAt ?? rhs.createdAt ?? .distantPast
                return l == r ? lhs.id > rhs.id : l > r
            }
    }

    /// The conversation the chat should open by default: the most recently active open
    /// conversation, else the most recently active one of any status.
    static func preferredConversationId(_ conversations: [ClayverConversation]) -> String? {
        conversations.first(where: { $0.status == .open })?.id ?? conversations.first?.id
    }

    /// The conversation a new message without an explicit id goes to: the newest open one.
    static func openConversationId(_ conversations: [ClayverConversation]) -> String? {
        conversations.first(where: { $0.status == .open })?.id
    }

    static func publicConfig(_ value: Any?) -> ClayverPublicConfig? {
        guard let dict = value as? [String: Any] else { return nil }
        return ClayverPublicConfig(
            teamName: string(dict["teamName"]),
            welcomeMessage: string(dict["welcomeMessage"]),
            accentColor: string(dict["accentColor"])
        )
    }
}
