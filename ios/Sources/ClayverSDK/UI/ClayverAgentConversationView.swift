#if canImport(UIKit)
import SwiftUI
import UIKit

/// One conversation from the support team's side: real-time messages (customer on the left,
/// team on the right), history paging, replies with attachments, "Seen" receipts from the
/// customer's read marker. The "…" button opens the Details sheet: the customer's profile,
/// assignment, open/closed, priority, status, tags, internal notes, the customer's other
/// conversations and blocking.
///
/// Usually reached from `ClayverAgentInboxView`. Put it in a navigation container when used
/// on its own.
@MainActor
public struct ClayverAgentConversationView: View {
    @StateObject private var model: ClayverAgentConversationViewModel
    private let theme: ClayverTheme

    @State private var preview: PreviewItem?
    @State private var openingAttachment = false
    @State private var showDetails = false
    /// Set from the Details sheet; opened once the sheet is dismissed.
    @State private var pendingConversationId: String?
    @State private var openConversationId: String?

    @MainActor
    public init(conversationId: String, theme: ClayverTheme? = nil) {
        _model = StateObject(wrappedValue: ClayverAgentConversationViewModel(dataSource: Clayver.agentDataSource, conversationId: conversationId))
        self.theme = theme ?? Clayver.configuredTheme
    }

    /// Drives the view with your own model (tests, previews, custom data sources).
    @MainActor
    public init(viewModel: @autoclosure @escaping () -> ClayverAgentConversationViewModel, theme: ClayverTheme = .default) {
        _model = StateObject(wrappedValue: viewModel())
        self.theme = theme
    }

    public var body: some View {
        VStack(spacing: 0) {
            if model.conversation != nil {
                AgentConversationSummaryBar(model: model, theme: theme, showDetails: { showDetails = true })
                Divider()
            }
            content
            if let error = model.connectionError {
                ConnectionBanner(message: error, theme: theme, retry: { model.retry() })
            }
            Divider()
            ComposerView(model: model, theme: theme)
        }
        .background(Color(UIColor.systemBackground).ignoresSafeArea())
        .navigationTitle(model.customerName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showDetails = true
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Conversation details")
            }
        }
        .tint(theme.accentColor)
        .onAppear {
            model.start()
            model.setVisible(true)
        }
        .onDisappear { model.setVisible(false) }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            model.setVisible(true)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in
            model.setVisible(false)
        }
        .alert("Something went wrong", isPresented: Binding(
            get: { model.alertMessage != nil },
            set: { if !$0 { model.alertMessage = nil } }
        )) {
            Button("OK", role: .cancel) { model.alertMessage = nil }
        } message: {
            Text(model.alertMessage ?? "")
        }
        .sheet(item: $preview) { item in
            QuickLookPreview(url: item.url).ignoresSafeArea()
        }
        .sheet(isPresented: $showDetails, onDismiss: {
            if let id = pendingConversationId {
                pendingConversationId = nil
                openConversationId = id
            }
        }) {
            NavigationView {
                AgentConversationDetailsView(
                    model: model,
                    theme: theme,
                    onDone: { showDetails = false },
                    openConversation: { id in
                        pendingConversationId = id
                        showDetails = false
                    }
                )
            }
            .navigationViewStyle(.stack)
        }
        .background(
            NavigationLink(
                destination: otherConversation,
                isActive: Binding(
                    get: { openConversationId != nil },
                    set: { if !$0 { openConversationId = nil } }
                )
            ) { EmptyView() }
            .accessibilityHidden(true)
        )
        .overlay {
            if openingAttachment {
                ProgressView()
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityLabel("Opening attachment")
            }
        }
    }

    /// Another conversation of the customer, opened from the Details sheet.
    @ViewBuilder
    private var otherConversation: some View {
        if let id = openConversationId {
            ClayverAgentConversationView(viewModel: model.makeViewModel(forConversation: id), theme: theme)
                .id(id)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.loadState {
        case .idle, .loading where model.rows.isEmpty:
            StateMessageView(theme: theme) {
                ProgressView()
                Text("Loading conversation…").font(theme.bodyFont).foregroundColor(.secondary)
            }
            .accessibilityElement(children: .combine)
        case .failed(let message) where model.rows.isEmpty:
            StateMessageView(theme: theme) {
                Image(systemName: "exclamationmark.bubble")
                    .font(.largeTitle)
                    .foregroundColor(.secondary)
                    .accessibilityHidden(true)
                Text("Couldn't load the conversation").font(theme.headlineFont)
                Text(message).font(theme.bodyFont).foregroundColor(.secondary).multilineTextAlignment(.center)
                Button("Try again", action: { model.retry() })
                    .buttonStyle(.borderedProminent)
            }
        default:
            if model.rows.isEmpty {
                StateMessageView(theme: theme) {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.largeTitle)
                        .foregroundColor(theme.accentColor)
                        .accessibilityHidden(true)
                    Text("No messages yet").font(theme.headlineFont)
                }
                .accessibilityElement(children: .combine)
            } else {
                MessageListView(model: model, theme: theme, open: { open($0) })
            }
        }
    }

    private func open(_ attachment: ClayverAttachment) {
        guard !openingAttachment else { return }
        openingAttachment = true
        Task { @MainActor in
            defer { openingAttachment = false }
            do {
                let url = try await model.localFile(for: attachment)
                preview = PreviewItem(url: url)
            } catch is CancellationError {
            } catch {
                model.alertMessage = ClayverChatViewModel.describe(error)
            }
        }
    }
}

/// One line above the messages: open/closed, priority, status, assignee and tags. Tapping it
/// opens the Details sheet, where they are changed.
@MainActor
private struct AgentConversationSummaryBar: View {
    @ObservedObject var model: ClayverAgentConversationViewModel
    let theme: ClayverTheme
    let showDetails: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Text(model.isClosed ? "Closed" : "Open")
                    .font(theme.captionFont.weight(.semibold))
                    .foregroundColor(model.isClosed ? .secondary : theme.accentColor)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(
                        Capsule().fill(model.isClosed ? Color(UIColor.tertiarySystemFill) : theme.accentColor.opacity(0.15))
                    )
                if let priority = model.priorityOption {
                    TagChip(name: priority.name, color: priority.color, theme: theme)
                }
                if let stage = model.stageOption {
                    TagChip(name: stage.name, color: stage.color, theme: theme)
                }
                Label(model.assigneeName ?? "Unassigned", systemImage: model.isAssigned ? "person.crop.circle.fill" : "person.crop.circle")
                    .font(theme.captionFont)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                ForEach(model.tags) { tag in
                    TagChip(name: tag.name, color: tag.color, theme: theme)
                }
                if model.isUpdating || model.isUpdatingTriage {
                    ProgressView()
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .onTapGesture(perform: showDetails)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("Opens the conversation details")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { showDetails() }
    }

    private var accessibilityText: String {
        var parts = [model.isClosed ? "Closed" : "Open"]
        if let priority = model.priorityOption { parts.append("Priority \(priority.name)") }
        if let stage = model.stageOption { parts.append("Status \(stage.name)") }
        parts.append(model.assigneeName.map { "Assigned to \($0 == "You" ? "you" : $0)" } ?? "Unassigned")
        if !model.tags.isEmpty { parts.append("Tags: " + model.tags.map(\.name).joined(separator: ", ")) }
        return parts.joined(separator: ", ")
    }
}
#endif
