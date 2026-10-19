import Foundation

/// Parsing of the team-side records (`conversations/{id}`, `users/{cid}`). Pure, like the rest
/// of `ClayverParsing`.
extension ClayverParsing {
    static func lastMessage(_ value: Any?) -> ClayverConversation.LastMessage? {
        guard let last = value as? [String: Any] else { return nil }
        return .init(
            text: string(last["text"]),
            senderType: string(last["senderType"]).flatMap(ClayverMessage.SenderType.init(rawValue:)) ?? .unknown,
            createdAt: date(last["createdAt"]),
            hasAttachment: bool(last["hasAttachment"]) ?? false
        )
    }

    /// Parses `conversations/{id}`. Returns `nil` without a `customerId`.
    static func agentConversation(id: String, value: Any?) -> ClayverAgentConversation? {
        guard let dict = value as? [String: Any],
              let customerId = string(dict["customerId"]), !customerId.isEmpty else { return nil }
        let unread = (dict["unread"] as? [String: Any]).flatMap { int($0["agent"]) } ?? 0
        let assignee = string(dict["assigneeUid"]).flatMap { $0.isEmpty ? nil : $0 }
        return ClayverAgentConversation(
            id: id,
            customerId: customerId,
            status: string(dict["status"]).flatMap(ClayverConversation.Status.init(rawValue:)) ?? .unknown,
            createdAt: date(dict["createdAt"]),
            updatedAt: date(dict["updatedAt"]),
            lastMessage: lastMessage(dict["lastMessage"]),
            unreadForAgents: max(0, unread),
            assigneeUid: assignee
        )
    }

    /// Parses the children of a `statusOrder` query, newest activity first.
    static func agentConversations(children: [(key: String, value: Any?)]) -> [ClayverAgentConversation] {
        sortedNewestFirst(children.compactMap { agentConversation(id: $0.key, value: $0.value) })
    }

    static func sortedNewestFirst(_ conversations: [ClayverAgentConversation]) -> [ClayverAgentConversation] {
        conversations.sorted { lhs, rhs in
            let l = lhs.lastActivityAt ?? .distantPast
            let r = rhs.lastActivityAt ?? .distantPast
            return l == r ? lhs.id > rhs.id : l > r
        }
    }

    /// A property value as stored by `setUserProperties`: string, number or boolean.
    static func value(_ raw: Any?) -> ClayverValue? {
        if let string = raw as? String { return .string(string) }
        guard let number = raw as? NSNumber else { return nil }
        if CFGetTypeID(number as CFTypeRef) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
        if CFNumberIsFloatType(number as CFNumber) { return .double(number.doubleValue) }
        return .int(number.intValue)
    }

    /// Parses `users/{customerId}`. A missing record is an empty profile.
    static func customerProfile(customerId: String, value: Any?) -> ClayverCustomerProfile {
        let dict = value as? [String: Any] ?? [:]
        var properties: [String: ClayverValue] = [:]
        for (key, raw) in dict["properties"] as? [String: Any] ?? [:] {
            if let parsed = self.value(raw) { properties[key] = parsed }
        }
        return ClayverCustomerProfile(
            customerId: customerId,
            account: customerAccount(dict["account"]),
            properties: properties,
            lastSeenAt: date(dict["lastSeenAt"])
        )
    }

    /// Parses `users/{customerId}/account`. `nil` when missing or malformed.
    static func customerAccount(_ value: Any?) -> ClayverCustomerAccount? {
        guard let dict = value as? [String: Any], let anonymous = bool(dict["anonymous"]) else { return nil }
        return ClayverCustomerAccount(
            anonymous: anonymous,
            email: string(dict["email"]).flatMap { $0.isEmpty ? nil : $0 },
            emailVerified: bool(dict["emailVerified"]) ?? false,
            displayName: string(dict["displayName"]).flatMap { $0.isEmpty ? nil : $0 }
        )
    }

    /// Parses `tags/{id}`. Returns `nil` without a name; a missing or malformed color falls
    /// back to the palette color of the id.
    static func tag(id: String, value: Any?) -> ClayverTag? {
        guard let dict = value as? [String: Any],
              let name = string(dict["name"])?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else { return nil }
        let color = string(dict["color"]).flatMap { ClayverTagRules.isValidColor($0) ? $0 : nil }
        return ClayverTag(id: id, name: name, color: color ?? ClayverTagRules.defaultColor(forSlug: id))
    }

    /// Parses the `tags` catalog, by name.
    static func tags(children: [(key: String, value: Any?)]) -> [ClayverTag] {
        ClayverTag.sortedByName(children.compactMap { tag(id: $0.key, value: $0.value) })
    }

    /// Parses `conversationTags/{conversationId}`: the ids whose value is `true`, sorted.
    static func tagIds(_ value: Any?) -> [String] {
        guard let dict = value as? [String: Any] else { return [] }
        return dict.compactMap { bool($0.value) == true ? $0.key : nil }.sorted()
    }

    // MARK: Triage

    /// Whether `id` is a valid triage option id: `^[a-z0-9][a-z0-9_-]{0,39}$`.
    static func isValidTriageOptionId(_ id: String) -> Bool {
        let scalars = Array(id.unicodeScalars)
        guard (1...40).contains(scalars.count) else { return false }
        let letters: ClosedRange<Unicode.Scalar> = "a"..."z"
        let digits: ClosedRange<Unicode.Scalar> = "0"..."9"
        func isAlnum(_ c: Unicode.Scalar) -> Bool { letters.contains(c) || digits.contains(c) }
        guard isAlnum(scalars[0]) else { return false }
        return scalars.dropFirst().allSatisfy { isAlnum($0) || $0 == "_" || $0 == "-" }
    }

    /// Parses `triage/{conversationId}`. Missing or malformed fields are unset.
    static func triage(_ value: Any?) -> ClayverTriage {
        guard let dict = value as? [String: Any] else { return .none }
        func optionId(_ raw: Any?) -> String? {
            guard let id = string(raw), isValidTriageOptionId(id) else { return nil }
            return id
        }
        return ClayverTriage(priority: optionId(dict["priority"]), stage: optionId(dict["stage"]))
    }

    /// Parses `triageOptions/{kind}`: the defaults while the list has never been saved,
    /// otherwise its valid entries by `order`.
    static func triageOptionList(_ value: Any?, kind: ClayverTriageOption.Kind) -> [ClayverTriageOption] {
        guard let dict = value as? [String: Any] else { return ClayverTriageOption.defaults(for: kind) }
        let options: [ClayverTriageOption] = dict.compactMap { key, raw in
            guard isValidTriageOptionId(key), let entry = raw as? [String: Any],
                  let name = string(entry["name"])?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else { return nil }
            let color = string(entry["color"]).flatMap { ClayverTagRules.isValidColor($0) ? $0 : nil } ?? "#64748B"
            let order = (entry["order"] as? NSNumber)?.doubleValue ?? 0
            return ClayverTriageOption(id: key, name: name, color: color, order: order)
        }
        return ClayverTriageOption.sorted(options)
    }

    /// Parses the whole `triageOptions` node.
    static func triageOptions(_ value: Any?) -> ClayverTriageOptions {
        let dict = value as? [String: Any] ?? [:]
        return ClayverTriageOptions(
            priority: triageOptionList(dict[ClayverTriageOption.Kind.priority.rawValue], kind: .priority),
            stage: triageOptionList(dict[ClayverTriageOption.Kind.stage.rawValue], kind: .stage)
        )
    }

    // MARK: Notes

    /// Parses `notes/{conversationId}/{noteId}`. `nil` without an author or text.
    static func note(id: String, conversationId: String, value: Any?) -> ClayverInternalNote? {
        guard let dict = value as? [String: Any],
              let authorUid = string(dict["authorUid"]), !authorUid.isEmpty,
              let text = string(dict["text"]), !text.isEmpty else { return nil }
        return ClayverInternalNote(
            id: id,
            conversationId: conversationId,
            authorUid: authorUid,
            authorName: string(dict["authorName"]).flatMap { $0.isEmpty ? nil : $0 },
            text: text,
            createdAt: date(dict["createdAt"])
        )
    }

    /// Parses `notes/{conversationId}`, newest first (push ids break ties).
    static func notes(conversationId: String, children: [(key: String, value: Any?)]) -> [ClayverInternalNote] {
        children.compactMap { note(id: $0.key, conversationId: conversationId, value: $0.value) }
            .sorted { lhs, rhs in
                let l = lhs.createdAt ?? .distantPast
                let r = rhs.createdAt ?? .distantPast
                return l == r ? lhs.id > rhs.id : l > r
            }
    }

    // MARK: Team

    /// Parses `agents`: uid → display name (`displayName`, else the name part of `email`).
    static func agentNames(_ value: Any?) -> [String: String] {
        guard let dict = value as? [String: Any] else { return [:] }
        var names: [String: String] = [:]
        for (uid, raw) in dict {
            guard let record = raw as? [String: Any] else { continue }
            let displayName = string(record["displayName"])?.trimmingCharacters(in: .whitespacesAndNewlines)
            let emailName = string(record["email"])?.components(separatedBy: "@").first?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let name = [displayName, emailName].compactMap({ $0 }).first(where: { !$0.isEmpty }) {
                names[uid] = name
            }
        }
        return names
    }
}
