import SwiftUI

@main
struct ClayverExampleApp: App {
    // Push registration, FCM token and notification taps live in the AppDelegate.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var session = SessionModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(session)
        }
    }
}
