#if canImport(UIKit)
import SwiftUI
import UIKit
import UserNotifications

/// Drives the "turn on notifications" banner at the top of the customer chat.
///
/// Shown when notifications are not determined yet (tapping asks for permission) or denied
/// (tapping explains how to enable them in Settings). Hidden when they are authorized, when
/// `ClayverOptions.showsNotificationPrompt` is `false`, and for a day after the customer
/// dismisses it.
@MainActor
final class ClayverNotificationPromptModel: ObservableObject {
    enum State: Equatable {
        case hidden
        /// The system permission prompt can still be shown.
        case notDetermined
        /// The customer turned notifications off; only the Settings app can turn them back on.
        case denied
    }

    @Published private(set) var state: State = .hidden
    @Published var showsSettingsAlert = false

    private static let dismissedAtKey = "com.clayver.notificationPrompt.dismissedAt"
    private static let dismissInterval: TimeInterval = 24 * 60 * 60

    /// Reads the current authorization status and updates `state`.
    func refresh() async {
        guard Clayver.configuredShowsNotificationPrompt, !Self.recentlyDismissed else {
            state = .hidden
            return
        }
        let status = await Self.authorizationStatus()
        switch status {
        case .notDetermined:
            state = .notDetermined
        case .denied:
            state = .denied
        case .authorized, .provisional, .ephemeral:
            state = .hidden
        @unknown default:
            state = .hidden
        }
    }

    /// The banner's action.
    func turnOn() {
        switch state {
        case .notDetermined:
            Task { @MainActor in
                let granted = (try? await UNUserNotificationCenter.current()
                    .requestAuthorization(options: [.alert, .badge, .sound])) ?? false
                if granted {
                    // The app delegate forwards the APNs token to `Clayver.setPushToken(_:)`.
                    UIApplication.shared.registerForRemoteNotifications()
                }
                await refresh()
            }
        case .denied:
            showsSettingsAlert = true
        case .hidden:
            break
        }
    }

    /// Hides the banner for this screen and for the next day.
    func dismiss() {
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.dismissedAtKey)
        state = .hidden
    }

    func openSettings() {
        let urlString: String
        if #available(iOS 16.0, *) {
            urlString = UIApplication.openNotificationSettingsURLString
        } else {
            urlString = UIApplication.openSettingsURLString
        }
        guard let url = URL(string: urlString) else { return }
        UIApplication.shared.open(url)
    }

    private static var recentlyDismissed: Bool {
        let dismissedAt = UserDefaults.standard.double(forKey: dismissedAtKey)
        guard dismissedAt > 0 else { return false }
        return Date().timeIntervalSince1970 - dismissedAt < dismissInterval
    }

    private static func authorizationStatus() async -> UNAuthorizationStatus {
        await withCheckedContinuation { continuation in
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                continuation.resume(returning: settings.authorizationStatus)
            }
        }
    }
}

/// The banner itself. Owns the "notifications are off" alert so it does not clash with the
/// chat screen's own alert.
@MainActor
struct NotificationPromptBanner: View {
    @ObservedObject var model: ClayverNotificationPromptModel
    let theme: ClayverTheme

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: model.state == .denied ? "bell.slash" : "bell.badge")
                .foregroundColor(theme.accentColor)
                .accessibilityHidden(true)
            Text(message)
                .font(theme.captionFont)
                .foregroundColor(.primary)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Button(model.state == .denied ? "Settings" : "Turn on") { model.turnOn() }
                .font(theme.captionFont.weight(.semibold))
                .foregroundColor(theme.accentColor)
            Button {
                withAnimation { model.dismiss() }
            } label: {
                Image(systemName: "xmark")
                    .font(theme.captionFont.weight(.semibold))
                    .foregroundColor(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color(UIColor.secondarySystemBackground))
        .accessibilityElement(children: .contain)
        .alert("Notifications are turned off", isPresented: $model.showsSettingsAlert) {
            Button("Open Settings") { model.openSettings() }
            Button("Not now", role: .cancel) {}
        } message: {
            Text("To know when we reply, allow notifications for this app in Settings.")
        }
    }

    private var message: String {
        model.state == .denied
            ? "Notifications are off. Turn them on in Settings to know when we reply."
            : "Turn on notifications to know when we reply."
    }
}
#endif
