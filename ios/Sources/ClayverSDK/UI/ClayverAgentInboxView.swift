#if canImport(UIKit)
import SwiftUI
import UIKit

/// The agent inbox: Open and Closed conversations of the workspace, newest activity first,
/// filtered by tag with the row of tags under the tabs. Tapping a row opens
/// `ClayverAgentConversationView`.
///
/// Only users with an agent or admin role can use it (see `Clayver.isAgent()`); others see a
/// "not a support agent" error. Embed it in a navigation container:
/// ```swift
/// .sheet(isPresented: $showInbox) {
///     NavigationView { ClayverAgentInboxView(onClose: { showInbox = false }) }
///         .navigationViewStyle(.stack)
/// }
/// ```
/// `Clayver.openChat()` shows it to agents who chose **Switch to support agent**
/// (see `ClayverSupportView`).
@MainActor
public struct ClayverAgentInboxView: View {
    @StateObject private var model: ClayverAgentInboxViewModel
    private let theme: ClayverTheme
    private let onClose: (() -> Void)?
    private let onSwitchToCustomer: (() -> Void)?

    @State private var openConversationId: String?
    @State private var deepLinkConversationId: String?

    /// - Parameters:
    ///   - conversationId: Opens this conversation right away (e.g. from an agent push).
    ///   - theme: Overrides the theme given to `Clayver.configure`.
    ///   - onClose: When set, a Close button is shown in the navigation bar.
    ///   - onSwitchToCustomer: When set, a **Switch to regular user** button is shown at the
    ///     bottom. `ClayverSupportView` sets it.
    @MainActor
    public init(
        conversationId: String? = nil,
        theme: ClayverTheme? = nil,
        onClose: (() -> Void)? = nil,
        onSwitchToCustomer: (() -> Void)? = nil
    ) {
        _model = StateObject(wrappedValue: ClayverAgentInboxViewModel(dataSource: Clayver.agentDataSource))
        _deepLinkConversationId = State(initialValue: conversationId)
        self.theme = theme ?? Clayver.configuredTheme
        self.onClose = onClose
        self.onSwitchToCustomer = onSwitchToCustomer
    }

    /// Drives the view with your own model (tests, previews, custom data sources).
    @MainActor
    public init(
        viewModel: @autoclosure @escaping () -> ClayverAgentInboxViewModel,
        conversationId: String? = nil,
        theme: ClayverTheme = .default,
        onClose: (() -> Void)? = nil,
        onSwitchToCustomer: (() -> Void)? = nil
    ) {
        _model = StateObject(wrappedValue: viewModel())
        _deepLinkConversationId = State(initialValue: conversationId)
        self.theme = theme
        self.onClose = onClose
        self.onSwitchToCustomer = onSwitchToCustomer
    }

    public var body: some View {
        VStack(spacing: 0) {
            Picker("Conversations", selection: Binding(
                get: { model.status },
                set: { model.select(status: $0) }
            )) {
                Text("Open").tag(ClayverConversationStatus.open)
                Text("Closed").tag(ClayverConversationStatus.closed)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 8)
            .accessibilityLabel("Show conversations")

            if !model.tags.isEmpty {
                AgentInboxTagFilterRow(
                    tags: model.tags,
                    selectedTagId: model.selectedTagId,
                    theme: theme,
                    select: { model.select(tagId: $0) }
                )
            }

            content

            if let onSwitchToCustomer {
                Divider()
                Button(action: onSwitchToCustomer) {
                    Label("Switch to regular user", systemImage: "person")
                        .font(theme.bodyFont.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .accessibilityHint("Shows your own conversations")
            }
        }
        .background(Color(UIColor.systemBackground).ignoresSafeArea())
        .background(
            NavigationLink(
                destination: destination,
                isActive: Binding(
                    get: { openConversationId != nil },
                    set: { if !$0 { openConversationId = nil } }
                )
            ) { EmptyView() }
            .accessibilityHidden(true)
        )
        .navigationTitle("Inbox")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let onClose {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", action: onClose)
                        .accessibilityLabel("Close agent inbox")
                }
            }
        }
        .tint(theme.accentColor)
        .onAppear {
            model.start()
            if let id = deepLinkConversationId {
                deepLinkConversationId = nil
                // Push after the navigation container is on screen.
                DispatchQueue.main.async { openConversationId = id }
            }
        }
    }

    @ViewBuilder
    private var destination: some View {
        if let id = openConversationId {
            ClayverAgentConversationView(viewModel: model.conversationViewModel(for: id), theme: theme)
                .id(id)
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
                Image(systemName: "tray.full")
                    .font(.largeTitle)
                    .foregroundColor(.secondary)
                    .accessibilityHidden(true)
                Text("Couldn't load the inbox").font(theme.headlineFont)
                Text(message).font(theme.bodyFont).foregroundColor(.secondary).multilineTextAlignment(.center)
                Button("Try again", action: { model.retry() })
                    .buttonStyle(.borderedProminent)
            }
        default:
            if model.rows.isEmpty {
                StateMessageView(theme: theme) {
                    Image(systemName: model.status == .closed ? "archivebox" : "tray")
                        .font(.largeTitle)
                        .foregroundColor(theme.accentColor)
                        .accessibilityHidden(true)
                    Text(model.status == .closed ? "No closed conversations" : "No open conversations")
                        .font(theme.headlineFont)
                    Text(emptyMessage)
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
                                openConversationId = row.id
                            } label: {
                                AgentInboxRowView(row: row, theme: theme)
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
extension ClayverAgentInboxView {
    fileprivate var emptyMessage: String {
        if let tagId = model.selectedTagId {
            let name = model.tags.first(where: { $0.id == tagId })?.name ?? tagId
            return "No conversations tagged \u{201C}\(name)\u{201D}."
        }
        return model.status == .closed
            ? "Conversations you close show up here."
            : "New conversations from customers show up here."
    }
}

@MainActor
struct AgentInboxRowView: View {
    let row: ClayverAgentInboxRow
    let theme: ClayverTheme

    @ScaledMetric(relativeTo: .body) private var avatarSize: CGFloat = 40

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(theme.accentColor.opacity(0.15))
                .frame(width: avatarSize, height: avatarSize)
                .overlay(
                    Text(Self.initials(row.customerName))
                        .font(theme.captionFont.weight(.semibold))
                        .foregroundColor(theme.accentColor)
                )
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(row.customerName)
                        .font(theme.bodyFont.weight(row.unreadCount > 0 ? .semibold : .regular))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if let date = row.lastActivityAt {
                        Text(Self.relativeTime(date))
                            .font(theme.captionFont)
                            .foregroundColor(.secondary)
                    }
                }
                HStack(alignment: .center, spacing: 6) {
                    if row.hasMessages && !row.lastMessageFromCustomer {
                        Image(systemName: "arrowshape.turn.up.left")
                            .font(theme.captionFont)
                            .foregroundColor(.secondary)
                    }
                    Text(row.preview)
                        .font(theme.bodyFont)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                    Spacer(minLength: 4)
                    if row.isAssigned {
                        Image(systemName: row.isAssignedToMe ? "person.crop.circle.badge.checkmark" : "person.crop.circle")
                            .foregroundColor(row.isAssignedToMe ? theme.accentColor : .secondary)
                    }
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
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("Opens the conversation")
        .accessibilityAddTraits(.isButton)
    }

    private var accessibilityText: String {
        var parts = [row.customerName]
        if row.unreadCount > 0 { parts.append(row.unreadCount == 1 ? "1 unread message" : "\(row.unreadCount) unread messages") }
        if row.isAssignedToMe {
            parts.append("Assigned to you")
        } else if row.isAssigned {
            parts.append("Assigned to a teammate")
        }
        parts.append(row.hasMessages && !row.lastMessageFromCustomer ? "Team: \(row.preview)" : row.preview)
        if let date = row.lastActivityAt { parts.append(Self.relativeTime(date)) }
        return parts.joined(separator: ", ")
    }

    static func initials(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0.isWhitespace || $0 == "@" || $0 == "." }).prefix(2)
        let letters = words.compactMap { $0.first.map(String.init) }.joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }

    static func relativeTime(_ date: Date, now: Date = Date()) -> String {
        if abs(now.timeIntervalSince(date)) < 60 { return "now" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }
}
#endif
