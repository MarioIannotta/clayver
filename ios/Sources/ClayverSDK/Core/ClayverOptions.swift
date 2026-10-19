import Foundation
import FirebaseCore

/// Options passed to `Clayver.configure(_:)`.
public struct ClayverOptions {
    /// Local Firebase Emulator Suite ports. Debug builds only.
    public struct Emulator: Equatable {
        public var host: String
        public var authPort: Int
        public var databasePort: Int
        public var functionsPort: Int
        public var storagePort: Int

        public init(host: String = "localhost", authPort: Int = 9099, databasePort: Int = 9000, functionsPort: Int = 5001, storagePort: Int = 9199) {
            self.host = host
            self.authPort = authPort
            self.databasePort = databasePort
            self.functionsPort = functionsPort
            self.storagePort = storagePort
        }
    }

    /// The Clayver workspace inside the Firebase project. `^[a-z0-9-]{1,40}$`.
    public var projectId: String
    /// Region the Clayver Cloud Functions are deployed to.
    public var functionsRegion: String
    /// URL of a non-default Realtime Database instance, e.g. `https://my-db.europe-west1.firebasedatabase.app`.
    public var databaseURL: String?
    /// The Firebase app to use. Defaults to `FirebaseApp.app()`; if there is no default app,
    /// `FirebaseApp.configure()` is called (reads `GoogleService-Info.plist`).
    public var firebaseApp: FirebaseApp?
    /// Appearance of the built-in chat UI.
    public var theme: ClayverTheme
    /// Connects Auth, Database, Functions and Storage to the local emulators.
    public var useEmulator: Emulator?
    /// Whether the built-in UI offers several conversations per customer. When `true`
    /// (the default), `Clayver.openChat()` opens the conversation list if the customer has a
    /// conversation, and a new empty chat otherwise. When `false`, it opens the latest
    /// conversation (or a new one) and there is no list.
    public var multipleConversations: Bool
    /// Whether the SDK signs in anonymously when no Firebase user is signed in, so visitors can
    /// chat before they log in (the default). Set it to `false` when your app requires sign-in:
    /// the SDK then waits for your Firebase Auth sign-in, and calls that need a customer throw
    /// `ClayverError.notAuthenticated` until a user is signed in.
    public var signInAnonymously: Bool
    /// Whether the built-in chat shows a banner asking the customer to turn on notifications
    /// when they are not enabled (the default). When notifications were denied, tapping the
    /// banner explains how to enable them and offers to open the Settings app. Set it to
    /// `false` when your app asks for notification permission elsewhere.
    public var showsNotificationPrompt: Bool

    public init(
        projectId: String = "default",
        functionsRegion: String = "us-central1",
        databaseURL: String? = nil,
        firebaseApp: FirebaseApp? = nil,
        theme: ClayverTheme = .default,
        useEmulator: Emulator? = nil,
        multipleConversations: Bool = true,
        signInAnonymously: Bool = true,
        showsNotificationPrompt: Bool = true
    ) {
        self.projectId = projectId
        self.functionsRegion = functionsRegion
        self.databaseURL = databaseURL
        self.firebaseApp = firebaseApp
        self.theme = theme
        self.useEmulator = useEmulator
        self.multipleConversations = multipleConversations
        self.signInAnonymously = signInAnonymously
        self.showsNotificationPrompt = showsNotificationPrompt
    }
}
