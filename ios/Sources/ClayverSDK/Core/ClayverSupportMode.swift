import Foundation

/// Which side of the support UI `Clayver.openChat()` shows to a user who is also a support
/// agent: their own conversations (`customer`) or the team's inbox (`agent`).
enum ClayverSupportMode: String {
    case customer
    case agent
}

/// Remembers the support mode per workspace and signed-in user across launches
/// (`UserDefaults`). Users without a stored choice, or with no uid yet, are customers.
enum ClayverSupportModeStore {
    static func mode(uid: String?, projectId: String?, defaults: UserDefaults = .standard) -> ClayverSupportMode {
        guard let uid else { return .customer }
        return defaults.string(forKey: key(uid: uid, projectId: projectId))
            .flatMap(ClayverSupportMode.init(rawValue:)) ?? .customer
    }

    static func set(_ mode: ClayverSupportMode, uid: String?, projectId: String?, defaults: UserDefaults = .standard) {
        guard let uid else { return }
        defaults.set(mode.rawValue, forKey: key(uid: uid, projectId: projectId))
    }

    static func key(uid: String, projectId: String?) -> String {
        "clayver.supportMode.\(projectId ?? "default").\(uid)"
    }
}
