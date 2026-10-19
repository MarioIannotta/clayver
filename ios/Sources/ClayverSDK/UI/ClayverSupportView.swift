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
/// ```swift
/// .sheet(isPresented: $showSupport) {
///     ClayverSupportView(onClose: { showSupport = false })
/// }
/// ```
@MainActor
public struct ClayverSupportView: View {
    private let entry: ClayverConversationListView.Entry
    private let theme: ClayverTheme?
    private let onClose: () -> Void
    private let multipleConversations: Bool

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

    @MainActor
    init(entry: ClayverConversationListView.Entry, theme: ClayverTheme? = nil, onClose: @escaping () -> Void) {
        self.entry = entry
        self.theme = theme
        self.onClose = onClose
        self.multipleConversations = Clayver.configuredMultipleConversations
    }

    public var body: some View {
        NavigationView {
            if multipleConversations || entry == .list {
                ClayverConversationListView(entry: entry, theme: theme, onClose: onClose)
            } else {
                singleChat
            }
        }
        .navigationViewStyle(.stack)
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
}
#endif
