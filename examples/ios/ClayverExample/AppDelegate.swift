import UIKit
import UserNotifications
import FirebaseCore
import FirebaseMessaging
import ClayverSDK

/// Push registration state shown next to the "Register for push notifications" button.
@MainActor
final class PushRegistration: ObservableObject {
    enum Status: Equatable {
        case notRegistered
        case registering
        case denied
        case registered
        case failed(String)

        var label: String {
            switch self {
            case .notRegistered: return "Not registered"
            case .registering: return "Registering…"
            case .denied: return "Denied in Settings"
            case .registered: return "Registered"
            case .failed(let message): return "Failed: \(message)"
            }
        }
    }

    static let shared = PushRegistration()

    @Published var status: Status = .notRegistered

    /// Asks for notification permission (the system prompt appears only the first time),
    /// then registers with APNs. The AppDelegate receives the APNs token and passes it to
    /// `Clayver.setPushToken(_:)`, which fetches the FCM token and registers this device.
    func register() async {
        status = .registering
        let center = UNUserNotificationCenter.current()
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            guard granted else {
                status = .denied
                return
            }
            UIApplication.shared.registerForRemoteNotifications()
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    /// Re-registers on launch when permission was already granted, so the token stays current.
    func registerIfAuthorized() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            status = .registering
            UIApplication.shared.registerForRemoteNotifications()
        case .denied:
            status = .denied
        default:
            status = .notRegistered
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate, MessagingDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Reads GoogleService-Info.plist. Clayver.configure() would also do this if you skipped it.
        FirebaseApp.configure()

        Task {
            do {
                try await Clayver.configure(ClayverOptions(
                    projectId: "default",
                    functionsRegion: "us-central1",
                    theme: ClayverTheme(title: "Help", accentColor: .indigo)
                ))
            } catch {
                print("Clayver.configure failed: \(error.localizedDescription)")
            }
        }

        UNUserNotificationCenter.current().delegate = self
        Messaging.messaging().delegate = self
        // Permission is requested from the "Register for push notifications" button (or the
        // banner in the Clayver chat). If it was already granted, register again on launch.
        Task { await PushRegistration.shared.registerIfAuthorized() }
        return true
    }

    // MARK: APNs / FCM

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        // Hands the APNs token to Firebase Messaging, fetches the FCM token and registers
        // devices/customers/{cid}/{deviceId}. When the signed-in user is a support agent it also
        // registers devices/agents/{uid}/{deviceId}, so replies-needed pushes reach this phone
        // (the SDK moves both registrations when the Firebase user changes; call
        // Clayver.logout() before signing out). Waits for configure() if needed.
        Task {
            do {
                try await Clayver.setPushToken(deviceToken)
                await MainActor.run { PushRegistration.shared.status = .registered }
            } catch {
                print("Clayver.setPushToken failed: \(error.localizedDescription)")
                await MainActor.run { PushRegistration.shared.status = .failed(error.localizedDescription) }
            }
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("APNs registration failed: \(error.localizedDescription)")
        Task { @MainActor in PushRegistration.shared.status = .failed(error.localizedDescription) }
    }

    /// FCM rotates tokens; keep the Clayver registration current.
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken else { return }
        Task { try? await Clayver.setFCMToken(fcmToken) }
    }

    // MARK: Notifications

    /// Show Clayver pushes as banners while the app is in the foreground.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound, .badge])
    }

    /// A tap on a Clayver push opens the chat on that conversation. Pushes sent to agents
    /// (`audience: "agent"`) open the agent conversation view instead.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        if !Clayver.handleNotification(userInfo: userInfo) {
            // Not a Clayver push: handle your own notifications here.
        }
        completionHandler()
    }
}
