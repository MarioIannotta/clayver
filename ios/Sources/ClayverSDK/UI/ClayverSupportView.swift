#if canImport(UIKit)
import SwiftUI

/// The customer support UI in its own navigation container, the way `Clayver.openChat()`
/// presents it. Use it in a SwiftUI `.sheet` or `.fullScreenCover`.
///
/// With `ClayverOptions.multipleConversations` (the default) the conversation list is the root
/// of the navigation stack: with no `conversationId` it shows the list when the customer has a
/// conversation and pushes a new empty chat over it otherwise; a `conversationId` pushes that
/// conversation. A pushed chat has a back button to the list (top left) and Close (top right).
/// Without multiple conversations the chat is shown on its own, with Close only.
///
/// When the signed-in user is also a support agent (`Clayver.isAgent()`), the list has a
/// **Switch to support agent** button that replaces it with the team inbox
/// (`ClayverAgentInboxView`), which has a **Switch to regular user** button to come back. The
/// choice is remembered per user on this device: without a `conversationId`, the next time the
/// support UI opens on the same side.
///
/// ```swift
/// .sheet(isPresented: $showSupport) {
///     ClayverSupportView(onClose: { showSupport = false })
/// }
/// ```
@MainActor
public struct ClayverSupportView: View {
    private let theme: ClayverTheme?
    private let onClose: () -> Void
    private let multipleConversations: Bool
    /// Whether this entry follows the remembered mode. Opening a given customer conversation
    /// or a new chat always shows the customer side.
    private let followsStoredMode: Bool

    @State private var mode: ClayverSupportMode
    /// What the customer side shows. Switching back from the inbox shows the list.
    @State private var entry: ClayverConversationListView.Entry
    /// Pushed over the inbox when it first appears (agent push).
    @State private var agentConversationId: String?
    /// Whether to offer the switch to the inbox. Checked when the view appears.
    @State private var isAgent: Bool

    /// - Parameters:
    ///   - conversationId: The conversation to open. `nil` behaves like `Clayver.openChat()`.
    ///   - theme: Overrides the theme given to `Clayver.configure`.
    ///   - onClose: Called by the Close button; dismiss the sheet here.
    @MainActor
    public init(conversationId: String? = nil, theme: ClayverTheme? = nil, onClose: @escaping () -> Void) {
        self.init(
            entry: conversationId.map { ClayverConversationListView.Entry.conversation($0) } ?? .automatic,
            theme: theme,
            onClose: onClose
        )
    }

    /// - Parameter agentConversationId: Opens the inbox with this conversation pushed over it,
    ///   whatever the remembered mode (agent pushes). The remembered mode is not changed.
    @MainActor
    init(entry: ClayverConversationListView.Entry, agentConversationId: String? = nil, theme: ClayverTheme? = nil, onClose: @escaping () -> Void) {
        self.theme = theme
        self.onClose = onClose
        self.multipleConversations = Clayver.configuredMultipleConversations
        let follows = entry == .automatic || entry == .list
        self.followsStoredMode = follows
        let stored = follows ? Self.storedMode() : .customer
        let mode: ClayverSupportMode = agentConversationId != nil ? .agent : stored
        _mode = State(initialValue: mode)
        _entry = State(initialValue: entry)
        _agentConversationId = State(initialValue: agentConversationId)
        // Optimistic for a remembered agent; corrected by `checkRole()`.
        _isAgent = State(initialValue: mode == .agent)
    }

    public var body: some View {
        NavigationView {
            switch mode {
            case .agent:
                ClayverAgentInboxView(
                    conversationId: agentConversationId,
                    theme: theme,
                    onClose: onClose,
                    onSwitchToCustomer: { switchMode(to: .customer) }
                )
            case .customer:
                if multipleConversations || entry == .list {
                    ClayverConversationListView(
                        entry: entry,
                        theme: theme,
                        onClose: onClose,
                        onSwitchToAgent: isAgent ? { switchMode(to: .agent) } : nil
                    )
                } else {
                    singleChat
                }
            }
        }
        .navigationViewStyle(.stack)
        .task { await checkRole() }
    }

    /// Without multiple conversations: the chat alone, no list and no back button.
    @ViewBuilder
    private var singleChat: some View {
        switch entry {
        case .conversation(let id):
            ClayverChatView(conversationId: id, theme: theme, onClose: onClose)
        case .newConversation:
            ClayverChatView.newConversation(theme: theme, onClose: onClose)
        case .automatic, .list:
            ClayverChatView(conversationId: nil, theme: theme, onClose: onClose)
        }
    }

    private func switchMode(to newMode: ClayverSupportMode) {
        ClayverSupportModeStore.set(newMode, uid: Clayver.currentUid, projectId: Clayver.configuredProjectId)
        agentConversationId = nil
        if newMode == .customer { entry = .list }
        mode = newMode
    }

    /// Shows the switch only to agents, drops a remembered agent mode for a user who lost the
    /// role, and applies the remembered mode when `configure` had not finished at init.
    private func checkRole() async {
        let agent = (try? await Clayver.isAgent()) ?? false
        isAgent = agent
        if !agent {
            if mode == .agent && agentConversationId == nil { mode = .customer }
            return
        }
        if followsStoredMode && mode == .customer && Self.storedMode() == .agent {
            mode = .agent
        }
    }

    private static func storedMode() -> ClayverSupportMode {
        ClayverSupportModeStore.mode(uid: Clayver.currentUid, projectId: Clayver.configuredProjectId)
    }
}
#endif
