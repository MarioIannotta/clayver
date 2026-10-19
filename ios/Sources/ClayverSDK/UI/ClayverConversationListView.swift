#if canImport(UIKit)
import SwiftUI
import UIKit

/// The customer's conversations, newest activity first: the last message, its time and an
/// unread badge. Whether the team closed a conversation is not shown to the customer. Tapping a row opens the conversation; the
/// **New conversation** button opens an empty chat that creates its conversation when the first
/// message is sent.
///
/// Embed it in a navigation container:
/// ```swift
/// .sheet(isPresented: $showSupport) {
///     NavigationView { ClayverConversationListView(onClose: { showSupport = false }) }
///         .navigationViewStyle(.stack)
/// }
/// ```
/// or use `Clayver.openConversations()` from UIKit. `ClayverSupportView` wraps it the way
/// `Clayver.openChat()` shows it.
///
/// Chats opened from the list have a back button to it (top left) and, when `onClose` is set,
/// the same Close button as the list (top right), which closes the whole support UI.
@MainActor
public struct ClayverConversationListView: View {
    /// What the screen shows first.
    enum Entry: Equatable {
        /// The list.
        case list
        /// The list if the customer has a conversation, else the list with a new empty chat
        /// pushed on top (`openChat()`).
        case automatic
        /// The list with this conversation pushed on top (`openChat(conversationId:)`, pushes).
        case conversation(String)
        /// The list with a new empty chat pushed on top.
        case newConversation
    }

    private enum Destination: Hashable {
        case conversation(String)
        case newConversation(UUID)
    }

    @StateObject private var model: ClayverConversationListViewModel
    private let theme: ClayverTheme
    private let onClose: (() -> Void)?
    private let entry: Entry

    @State private var destination: Destination?
    @State private var handledEntry = false
    /// For `.automatic`: decided once, when the list first loads, so a later change to the rows
    /// (e.g. the pushed chat's first message creating a conversation) changes nothing.
    @State private var decidedAutomaticEntry = false

    /// - Parameters:
    ///   - theme: Overrides the theme given to `Clayver.configure`.
    ///   - onClose: When set, a Close button is shown at the trailing end of the navigation bar,
    ///     on the list and on the chats opened from it.
    @MainActor
    public init(theme: ClayverTheme? = nil, onClose: (() -> Void)? = nil) {
        self.init(entry: .list, theme: theme, onClose: onClose)
    }

    /// Drives the view with your own model (tests, previews, custom data sources).
    @MainActor
    public init(viewModel: @autoclosure @escaping () -> ClayverConversationListViewModel, theme: ClayverTheme = .default, onClose: (() -> Void)? = nil) {
        _model = StateObject(wrappedValue: viewModel())
        self.theme = theme
        self.onClose = onClose
        self.entry = .list
    }

    @MainActor
    init(entry: Entry, theme: ClayverTheme? = nil, onClose: (() -> Void)? = nil) {
        _model = StateObject(wrappedValue: ClayverConversationListViewModel(dataSource: Clayver.chatDataSource))
        self.theme = theme ?? Clayver.configuredTheme
        self.onClose = onClose
        self.entry = entry
    }

    public var body: some View {
        listScreen
    }

    private var listScreen: some View {
        VStack(spacing: 0) {
            content
            Divider()
            Button {
                destination = .newConversation(UUID())
            } label: {
                Label("New conversation", systemImage: "square.and.pencil")
                    .font(theme.bodyFont.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .accessibilityHint("Opens an empty chat")
        }
        .background(Color(UIColor.systemBackground).ignoresSafeArea())
        .background(
            NavigationLink(
                destination: destinationView,
                isActive: Binding(
                    get: { destination != nil },
                    set: { if !$0 { destination = nil } }
                )
            ) { EmptyView() }
            .accessibilityHidden(true)
        )
        .navigationTitle(theme.title ?? model.teamName ?? "Support")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let onClose {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Close", action: onClose)
                        .accessibilityLabel("Close support")
                }
            }
        }
        .tint(theme.accentColor)
        .onAppear {
            model.start()
            handleEntry()
            decideAutomaticEntry()
        }
        .onChange(of: model.loadState) { _ in decideAutomaticEntry() }
    }

    private func handleEntry() {
        guard !handledEntry else { return }
        handledEntry = true
        let target: Destination?
        switch entry {
        case .conversation(let id): target = .conversation(id)
        case .newConversation: target = .newConversation(UUID())
        case .list, .automatic: target = nil
        }
        // Push after the navigation container is on screen.
        if let target { DispatchQueue.main.async { destination = target } }
    }

    /// `.automatic`: a customer with no conversation yet gets a new chat pushed over the list,
    /// so its back button leads to the (empty) list.
    private func decideAutomaticEntry() {
        guard entry == .automatic, !decidedAutomaticEntry, model.loadState == .loaded else { return }
        decidedAutomaticEntry = true
        guard model.rows.isEmpty else { return }
        // Push after the navigation container is on screen.
        DispatchQueue.main.async { destination = .newConversation(UUID()) }
    }

    @ViewBuilder
    private var destinationView: some View {
        switch destination {
        case .conversation(let id)?:
            ClayverChatView(viewModel: model.chatViewModel(for: id), theme: theme, onClose: onClose)
                .id(id)
        case .newConversation(let token)?:
            ClayverChatView(viewModel: model.newConversationViewModel(), theme: theme, onClose: onClose)
                .id(token)
        case nil:
            EmptyView()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.loadState {
        case .idle, .loading where model.rows.isEmpty:
            StateMessageView(theme: theme) {
                ProgressView()
                Text("Loading conversations…").font(theme.bodyFont).foregroundColor(.secondary)
            }
            .accessibilityElement(children: .combine)
        case .failed(let message) where model.rows.isEmpty:
            StateMessageView(theme: theme) {
                Image(systemName: "exclamationmark.bubble")
                    .font(.largeTitle)
                    .foregroundColor(.secondary)
                    .accessibilityHidden(true)
                Text("Couldn't load your conversations").font(theme.headlineFont)
                Text(message).font(theme.bodyFont).foregroundColor(.secondary).multilineTextAlignment(.center)
                Button("Try again", action: { model.retry() })
                    .buttonStyle(.bordered)
            }
        default:
            if model.rows.isEmpty {
                StateMessageView(theme: theme) {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.largeTitle)
                        .foregroundColor(theme.accentColor)
                        .accessibilityHidden(true)
                    Text("No conversations yet").font(theme.headlineFont)
                    Text("Start a conversation and we'll get back to you as soon as we can.")
                        .font(theme.bodyFont)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
                .accessibilityElement(children: .combine)
            } else {
                VStack(spacing: 0) {
                    if case .failed(let message) = model.loadState {
                        ConnectionBanner(message: message, theme: theme, retry: { model.retry() })
                    }
                    List {
                        ForEach(model.rows) { row in
                            Button {
                                destination = .conversation(row.id)
                            } label: {
                                ConversationListRowView(row: row, theme: theme)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .listStyle(.plain)
                    .refreshable { model.retry() }
                }
            }
        }
    }
}

@MainActor
struct ConversationListRowView: View {
    let row: ClayverConversationListRow
    let theme: ClayverTheme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(row.preview)
                    .font(theme.bodyFont.weight(row.unreadCount > 0 ? .semibold : .regular))
                    .foregroundColor(row.hasMessages ? .primary : .secondary)
                    .lineLimit(2)
                Spacer(minLength: 4)
                if let date = row.lastActivityAt {
                    Text(ClayverConversationListLayout.timeLabel(for: date))
                        .font(theme.captionFont)
                        .foregroundColor(.secondary)
                }
            }
            HStack(spacing: 6) {
                if row.hasMessages && row.lastMessageFromCustomer {
                    Text("You")
                        .font(theme.captionFont)
                        .foregroundColor(.secondary)
                }
                Spacer(minLength: 4)
                if row.unreadCount > 0 {
                    Text(row.unreadCount > 99 ? "99+" : "\(row.unreadCount)")
                        .font(theme.captionFont.weight(.bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(theme.accentColor))
                }
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("Opens the conversation")
        .accessibilityAddTraits(.isButton)
    }

    private var accessibilityText: String {
        var parts: [String] = []
        if row.unreadCount > 0 { parts.append(row.unreadCount == 1 ? "1 unread message" : "\(row.unreadCount) unread messages") }
        parts.append(row.hasMessages && row.lastMessageFromCustomer ? "You: \(row.preview)" : row.preview)
        if let date = row.lastActivityAt { parts.append(ClayverConversationListLayout.timeLabel(for: date)) }
        return parts.joined(separator: ", ")
    }
}
#endif
