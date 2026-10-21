import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Entry point of the Clayver SDK. See `docs/sdk-api.md` for the cross-platform contract.
///
/// Customers and agents are Firebase Auth users of your app's Firebase project. Sign users in
/// with Firebase Auth as usual; the SDK follows the signed-in user (the customer id is the uid).
/// Without a signed-in user it signs in anonymously, unless `ClayverOptions.signInAnonymously`
/// is `false`.
///
/// ```swift
/// try await Clayver.configure()
/// Clayver.openChat()
///
/// // Signing out:
/// try await Clayver.logout()
/// try Auth.auth().signOut()
/// ```
public enum Clayver {
    public static let sdkVersion = "0.3.0"

    // MARK: - State

    private final class State: @unchecked Sendable {
        let lock = NSLock()
        var client: ClayverClient?
        var configureTask: Task<ClayverClient, Error>?
        /// Opens the chat for a push tapped before `configure` finished.
        var pendingOpen: (() -> Void)?

        /// Runs `body` while holding the lock (safe from async code, see `NSLock.locked`).
        func withLock<T>(_ body: (State) throws -> T) rethrows -> T {
            try lock.locked { try body(self) }
        }
    }

    private static let state = State()

    /// Whether `configure` has completed successfully.
    public static var isConfigured: Bool {
        state.withLock { $0.client != nil }
    }

    /// The configured client, waiting for an in-flight `configure` call if there is one.
    static func requireClient() async throws -> ClayverClient {
        let (client, task) = state.withLock { ($0.client, $0.configureTask) }
        if let client { return client }
        if let task { return try await task.value }
        throw ClayverError.notConfigured
    }

    /// The theme from the options passed to `configure`, or the default theme.
    static var configuredTheme: ClayverTheme {
        state.withLock { $0.client?.options.theme ?? .default }
    }

    static var configuredProjectId: String? {
        state.withLock { $0.client?.options.projectId }
    }

    /// The signed-in Firebase uid, `nil` before `configure` finishes or without a user.
    static var currentUid: String? {
        state.withLock { $0.client?.auth.currentUser?.uid }
    }

    /// `ClayverOptions.multipleConversations` from `configure`, `true` before it finishes.
    static var configuredMultipleConversations: Bool {
        state.withLock { $0.client?.options.multipleConversations ?? true }
    }

    /// `ClayverOptions.showsNotificationPrompt` from `configure`, `true` before it finishes.
    static var configuredShowsNotificationPrompt: Bool {
        state.withLock { $0.client?.options.showsNotificationPrompt ?? true }
    }

    static func run<T>(_ body: (ClayverClient) async throws -> T) async throws -> T {
        do {
            let client = try await requireClient()
            return try await body(client)
        } catch {
            throw clayverTranslate(error)
        }
    }

    // MARK: - Setup

    /// Configures the SDK: picks the Firebase app, signs in anonymously when there is no
    /// Firebase user (unless `signInAnonymously` is `false`), starts following Firebase Auth
    /// sign-ins and creates the per-installation device id.
    ///
    /// Calling it again after success is a no-op (the first options win). Concurrent calls
    /// share one configuration.
    public static func configure(_ options: ClayverOptions = .init()) async throws {
        let task: Task<ClayverClient, Error>? = state.withLock { state in
            if state.client != nil { return nil }
            if let existing = state.configureTask { return existing }
            let task = Task { try await ClayverClient.make(options: options) }
            state.configureTask = task
            return task
        }
        guard let task else { return }

        do {
            let client = try await task.value
            let pendingOpen = state.withLock { state -> (() -> Void)? in
                state.client = client
                state.configureTask = nil
                defer { state.pendingOpen = nil }
                return state.pendingOpen
            }
            pendingOpen?()
        } catch {
            state.withLock { state in
                if state.configureTask == task { state.configureTask = nil }
            }
            throw clayverTranslate(error)
        }
    }

    // MARK: - Identity

    /// Removes this device's push registrations for the signed-in user. Call it right before you
    /// sign the user out of Firebase Auth, so a signed-out device stops getting their
    /// notifications. An anonymous user is signed out by the SDK; your own signed-in user is
    /// not (call `Auth.auth().signOut()` yourself).
    public static func logout() async throws {
        try await run { try await $0.logout() }
    }

    /// Erases everything stored for the current customer (conversations, messages, attachments,
    /// properties, device registrations) with the `clayverDeleteMyData` function, then logs out.
    /// Call it from your app's account deletion flow.
    public static func deleteCustomerData() async throws {
        try await run { try await $0.deleteCustomerData() }
    }

    /// The current customer id: the Firebase uid of the signed-in user.
    public static func customerId() async throws -> String {
        try await run { try await $0.customerId() }
    }

    /// Writes `users/{cid}/properties/{key}`. Keys: `^[A-Za-z0-9_-]{1,64}$`;
    /// values: strings up to 1000 characters, numbers or booleans.
    /// `name` and `email` are shown prominently in the dashboard.
    public static func setUserProperties(_ properties: [String: ClayverValue]) async throws {
        try await run { try await $0.setUserProperties(properties) }
    }

    // MARK: - Push

    /// Hands the APNs device token to Firebase Messaging, fetches the FCM token and
    /// registers this device. Call from `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.
    public static func setPushToken(_ apnsToken: Data) async throws {
        try await run { try await $0.setAPNSToken(apnsToken) }
    }

    /// Registers an FCM registration token directly, e.g. from `MessagingDelegate`.
    public static func setFCMToken(_ token: String) async throws {
        try await run { try await $0.setFCMToken(token) }
    }

    /// Removes this device's push registration.
    public static func clearPushToken() async throws {
        try await run { try await $0.clearPushToken() }
    }

    /// Whether a notification's `userInfo` is a Clayver push.
    public static func isClayverNotification(userInfo: [AnyHashable: Any]) -> Bool {
        ClayverNotificationPayload.isClayver(userInfo)
    }

    #if canImport(UIKit)
    /// Handles a tapped notification. Returns `true` if it was a Clayver push, in which case
    /// the chat is opened on its conversation (after `configure` completes, if needed).
    /// Pushes sent to agents (`audience: "agent"`) open the support UI in agent mode on that
    /// conversation instead.
    /// Call from `userNotificationCenter(_:didReceive:withCompletionHandler:)`.
    @available(iOSApplicationExtension, unavailable)
    @discardableResult
    public static func handleNotification(userInfo: [AnyHashable: Any]) -> Bool {
        guard isClayverNotification(userInfo: userInfo) else { return false }
        guard let payload = ClayverNotificationPayload(userInfo: userInfo) else { return true }

        let configuredProject = state.withLock { state -> String? in
            if let projectId = state.client?.options.projectId { return projectId }
            // Typically a cold start from a notification tap: open once configure() finishes.
            state.pendingOpen = { [payload] in
                let route = ClayverNotificationRoute.route(for: payload, configuredProjectId: configuredProjectId)
                Task { @MainActor in perform(route) }
            }
            return nil
        }
        guard let configuredProject else { return true }

        let route = ClayverNotificationRoute.route(for: payload, configuredProjectId: configuredProject)
        if route == .ignore, let projectId = payload.projectId {
            clayverLog.info("Ignoring Clayver push for workspace \(projectId, privacy: .public).")
            return true
        }
        Task { @MainActor in perform(route) }
        return true
    }

    @available(iOSApplicationExtension, unavailable)
    @MainActor
    private static func perform(_ route: ClayverNotificationRoute) {
        switch route {
        case .customerChat(let conversationId):
            openChat(conversationId: conversationId)
        case .agentConversation(let conversationId):
            ClayverPresenter.presentAgentConversation(conversationId)
        case .ignore:
            break
        }
    }
    #endif

    // MARK: - Unread

    /// `inbox/{cid}/unreadTotal`: messages from the support team the customer has not read.
    public static func getUnreadMessagesCount() async throws -> Int {
        try await run { try await $0.unreadCount() }
    }

    /// Live unread count. The Firebase listener is removed when iteration stops.
    public static func unreadCountUpdates() -> AsyncThrowingStream<Int, Error> {
        deferredStream(resolve: { try await requireClient() }) { $0.unreadCountUpdates() }
    }

    // MARK: - Conversations & messages

    /// Live list of the customer's conversations, most recently active first.
    public static func conversations() -> AsyncThrowingStream<[ClayverConversation], Error> {
        deferredStream(resolve: { try await requireClient() }) { $0.conversations() }
    }

    /// Live view of the newest `limit` messages of a conversation, oldest first.
    /// Use `loadOlderMessages(conversationId:before:limit:)` for history.
    public static func messages(conversationId: String, limit: Int = 30) -> AsyncThrowingStream<[ClayverMessage], Error> {
        deferredStream(resolve: { try await requireClient() }) { $0.messages(conversationId: conversationId, limit: limit) }
    }

    /// Up to `limit` messages older than the message `before`, oldest first.
    public static func loadOlderMessages(conversationId: String, before: String, limit: Int = 30) async throws -> [ClayverMessage] {
        try await run { try await $0.loadOlderMessages(conversationId: conversationId, before: before, limit: limit) }
    }

    /// Sends a message as the customer. With no `conversationId`, the newest open conversation
    /// is used, or a new one is created. Attachments must be images (any `image/*`);
    /// they are re-encoded as JPEG of at most 300 KB (`ClayverImageCompressor`) before upload.
    @discardableResult
    public static func sendMessage(text: String? = nil, conversationId: String? = nil, attachment: ClayverAttachmentInput? = nil) async throws -> ClayverMessage {
        try await run { try await $0.sendMessage(text: text, conversationId: conversationId, attachment: attachment) }
    }

    /// Sends a message in a new conversation, created for it, even when the customer has an
    /// open one.
    @discardableResult
    public static func startConversation(text: String? = nil, attachment: ClayverAttachmentInput? = nil) async throws -> ClayverMessage {
        try await run { try await $0.startConversation(text: text, attachment: attachment) }
    }

    /// Live block state of the customer: a `ClayverBlockStatus` while `moderation/{cid}` holds an
    /// active block, else `nil`. A block with an end time turns into `nil` when it passes. While
    /// blocked, sends fail with `permissionDenied`.
    public static func blockStatus() -> AsyncThrowingStream<ClayverBlockStatus?, Error> {
        deferredStream(resolve: { try await requireClient() }) { $0.blockStatus() }
    }

    /// Marks the conversation read by the customer (`reads/{id}/customer/lastReadAt`).
    public static func markConversationRead(_ conversationId: String) async throws {
        try await run { try await $0.markConversationRead(conversationId) }
    }

    /// The data source behind `ClayverChatView`.
    public static var chatDataSource: ClayverChatDataSource {
        FirebaseChatDataSource(resolve: { try await requireClient() })
    }

    // MARK: - UI

    #if canImport(UIKit)
    /// Presents the chat modally from `viewController`, or from the top-most view controller.
    ///
    /// With `ClayverOptions.multipleConversations` (the default), no `conversationId` opens the
    /// conversation list when the customer has a conversation, and a new empty chat otherwise; a
    /// `conversationId` opens that conversation with a back button to the list. Without it, the
    /// latest conversation (or a new one) opens and there is no list.
    ///
    /// Agents (see `isAgent()`) get a **Switch to support agent** button under **New
    /// conversation** that turns the screen into the team inbox, and a **Switch to regular user**
    /// button there to come back. The choice is remembered per user on this device, so the next
    /// `openChat()` (without a `conversationId`) or `openConversations()` opens the same side.
    @available(iOSApplicationExtension, unavailable)
    @MainActor
    public static func openChat(conversationId: String? = nil, from viewController: UIViewController? = nil) {
        ClayverPresenter.present(conversationId: conversationId, from: viewController)
    }

    /// Presents the customer's conversation list (`ClayverConversationListView`) modally.
    @available(iOSApplicationExtension, unavailable)
    @MainActor
    public static func openConversations(from viewController: UIViewController? = nil) {
        ClayverPresenter.presentConversations(from: viewController)
    }

    /// Presents a new, empty chat. The conversation is created when the first message is sent.
    @available(iOSApplicationExtension, unavailable)
    @MainActor
    public static func openNewConversation(from viewController: UIViewController? = nil) {
        ClayverPresenter.presentNewConversation(from: viewController)
    }
    #endif
}
