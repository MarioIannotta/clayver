#if canImport(UIKit)
import SwiftUI
import UIKit

/// The Clayver chat screen.
///
/// Embed it in a navigation container:
/// ```swift
/// .sheet(isPresented: $showSupport) {
///     NavigationView { ClayverChatView() }
/// }
/// ```
/// To get the conversation list behind the chat (a back button to it), present
/// `ClayverSupportView` instead, or use `Clayver.openChat()` from UIKit.
@MainActor
public struct ClayverChatView: View {
    @StateObject private var model: ClayverChatViewModel
    private let theme: ClayverTheme
    private let onClose: (() -> Void)?

    /// - Parameters:
    ///   - conversationId: The conversation to show. `nil` opens the newest open conversation,
    ///     or starts a new one when the customer sends their first message.
    ///   - theme: Overrides the theme given to `Clayver.configure`.
    ///   - onClose: When set, a Close button is shown at the trailing end of the navigation bar.
    @MainActor
    public init(conversationId: String? = nil, theme: ClayverTheme? = nil, onClose: (() -> Void)? = nil) {
        self.init(conversationId: conversationId, startsNewConversation: false, theme: theme, onClose: onClose)
    }

    @MainActor
    init(conversationId: String?, startsNewConversation: Bool, theme: ClayverTheme?, onClose: (() -> Void)?) {
        _model = StateObject(wrappedValue: ClayverChatViewModel(
            dataSource: Clayver.chatDataSource,
            conversationId: conversationId,
            startsNewConversation: startsNewConversation
        ))
        self.theme = theme ?? Clayver.configuredTheme
        self.onClose = onClose
    }

    /// An empty chat whose first message starts a new conversation, even when the customer
    /// already has an open one.
    @MainActor
    public static func newConversation(theme: ClayverTheme? = nil, onClose: (() -> Void)? = nil) -> ClayverChatView {
        ClayverChatView(conversationId: nil, startsNewConversation: true, theme: theme, onClose: onClose)
    }

    /// Drives the view with your own model (tests, previews, custom data sources).
    @MainActor
    public init(viewModel: @autoclosure @escaping () -> ClayverChatViewModel, theme: ClayverTheme = .default, onClose: (() -> Void)? = nil) {
        _model = StateObject(wrappedValue: viewModel())
        self.theme = theme
        self.onClose = onClose
    }

    @State private var preview: PreviewItem?
    @State private var openingAttachment = false
    @StateObject private var notificationPrompt = ClayverNotificationPromptModel()

    public var body: some View {
        VStack(spacing: 0) {
            if notificationPrompt.state != .hidden {
                NotificationPromptBanner(model: notificationPrompt, theme: theme)
                    .transition(.move(edge: .top).combined(with: .opacity))
                Divider()
            }
            content
            if let error = model.connectionError {
                ConnectionBanner(message: error, theme: theme, retry: { model.retry() })
            }
            Divider()
            if model.isBlocked {
                BlockedNotice(theme: theme)
            } else {
                ComposerView(model: model, theme: theme)
            }
        }
        .background(Color(UIColor.systemBackground).ignoresSafeArea())
        .navigationTitle(theme.title ?? model.teamName ?? "Support")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let onClose {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Close", action: onClose)
                        .accessibilityLabel("Close support chat")
                }
            }
        }
        .tint(theme.accentColor)
        .onAppear {
            model.start()
            model.setVisible(true)
        }
        .task { await notificationPrompt.refresh() }
        .onDisappear { model.setVisible(false) }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            model.setVisible(true)
            // Picks up a permission changed in Settings (or in the system prompt).
            Task { await notificationPrompt.refresh() }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in
            model.setVisible(false)
        }
        .alert("Couldn't send", isPresented: Binding(
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
        .overlay {
            if openingAttachment {
                ProgressView()
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityLabel("Opening attachment")
            }
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
                    Text(model.teamName.map { "Chat with \($0)" } ?? "How can we help?").font(theme.headlineFont)
                    Text(model.welcomeMessage ?? "Send us a message and we'll get back to you as soon as we can.")
                        .font(theme.bodyFont)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
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

/// Shown instead of the composer while the customer is blocked (`moderation/{cid}`).
@MainActor
struct BlockedNotice: View {
    let theme: ClayverTheme

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "nosign")
                .foregroundColor(.secondary)
                .accessibilityHidden(true)
            Text("You can't send messages right now.")
                .font(theme.bodyFont)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .accessibilityElement(children: .combine)
    }
}

struct PreviewItem: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

@MainActor
struct StateMessageView<Content: View>: View {
    let theme: ClayverTheme
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 12) {
            Spacer(minLength: 0)
            content
            Spacer(minLength: 0)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

@MainActor
struct ConnectionBanner: View {
    let message: String
    let theme: ClayverTheme
    let retry: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.exclamationmark").accessibilityHidden(true)
            Text(message).font(theme.captionFont).lineLimit(2)
            Spacer()
            Button("Retry", action: retry).font(theme.captionFont.weight(.semibold))
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color(UIColor.secondarySystemBackground))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Connection problem. \(message)")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(named: "Retry", retry)
    }
}

/// The scrolling list of messages with "load older" at the top.
@MainActor
struct MessageListView<Model: ClayverThreadModel>: View {
    @ObservedObject var model: Model
    let theme: ClayverTheme
    let open: (ClayverAttachment) -> Void

    /// Avoids loading history before the initial scroll to the bottom has happened.
    @State private var canLoadOlder = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 4) {
                    if model.hasOlderMessages || model.olderMessagesError != nil {
                        olderHeader(proxy: proxy)
                    }
                    ForEach(model.rows) { row in
                        rowView(row).id(row.id)
                    }
                    Color.clear.frame(height: 1).id(bottomId)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .onAppear {
                proxy.scrollTo(bottomId, anchor: .bottom)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { canLoadOlder = true }
            }
            .onChange(of: model.rows.last?.id) { _ in
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(bottomId, anchor: .bottom)
                }
            }
        }
    }

    private var bottomId: String { "clayver-bottom" }

    @ViewBuilder
    private func olderHeader(proxy: ScrollViewProxy) -> some View {
        Group {
            if let error = model.olderMessagesError {
                Button {
                    loadOlder(proxy: proxy)
                } label: {
                    Label("Couldn't load earlier messages. Tap to retry.", systemImage: "arrow.clockwise")
                        .font(theme.captionFont)
                }
                .accessibilityHint(error)
            } else {
                ProgressView()
                    .opacity(model.isLoadingOlder ? 1 : 0.4)
                    .accessibilityLabel("Loading earlier messages")
                    .onAppear { if canLoadOlder { loadOlder(proxy: proxy) } }
                    .onChange(of: canLoadOlder) { ready in if ready { loadOlder(proxy: proxy) } }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private func loadOlder(proxy: ScrollViewProxy) {
        guard !model.isLoadingOlder else { return }
        let anchor = model.rows.first(where: { if case .message = $0 { return true } else { return false } })?.id
        Task { @MainActor in
            await model.loadOlder()
            if let anchor { proxy.scrollTo(anchor, anchor: .top) }
        }
    }

    @ViewBuilder
    private func rowView(_ row: ClayverChatRow) -> some View {
        switch row {
        case .day(let date):
            Text(Self.dayLabel(date))
                .font(theme.captionFont.weight(.semibold))
                .foregroundColor(.secondary)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity)
                .accessibilityAddTraits(.isHeader)
        case .newMessagesDivider:
            HStack(spacing: 8) {
                Rectangle().fill(theme.accentColor).frame(height: 1)
                Text("New messages")
                    .font(theme.captionFont.weight(.semibold))
                    .foregroundColor(theme.accentColor)
                    .fixedSize()
                Rectangle().fill(theme.accentColor).frame(height: 1)
            }
            .padding(.vertical, 6)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("New messages below")
        case .message(let item):
            MessageBubbleView(
                item: item,
                theme: theme,
                perspective: model.perspective,
                loadURL: { try await model.url(for: $0) },
                open: open,
                retry: { model.retrySend(id: item.id) },
                discard: { model.discardFailed(id: item.id) }
            )
        }
    }

    static func dayLabel(_ date: Date) -> String { ClayverDayLabel.string(for: date) }
}

enum ClayverDayLabel {
    static func string(for date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        let formatter = DateFormatter()
        formatter.doesRelativeDateFormatting = true
        formatter.dateStyle = calendar.isDate(date, equalTo: Date(), toGranularity: .year) ? .medium : .long
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}
#endif
