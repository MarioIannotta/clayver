import SwiftUI
import FirebaseAuth
import ClayverSDK

/// Demo login state. Users sign in with Firebase Auth in your app's Firebase project; Clayver
/// follows the signed-in user on its own (the customer id is the Firebase uid).
@MainActor
final class SessionModel: ObservableObject {
    @Published var email = ""
    @Published var password = ""
    /// Email of the signed-in (non-anonymous) Firebase user.
    @Published private(set) var loggedInAs: String?
    @Published private(set) var busy = false
    @Published var errorMessage: String?

    private var authListener: AuthStateDidChangeListenerHandle?

    init() {
        authListener = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            self?.loggedInAs = (user?.isAnonymous ?? true) ? nil : (user?.email ?? user?.uid)
        }
    }

    deinit {
        if let authListener { Auth.auth().removeStateDidChangeListener(authListener) }
    }

    func signIn() async {
        await perform {
            try await Auth.auth().signIn(withEmail: self.email, password: self.password)
        }
    }

    /// Creates the account. When the current user is anonymous (the SDK signed them in so they
    /// could chat before logging in), the new credential is linked to that user, so the uid
    /// and their conversations are kept.
    func signUp() async {
        await perform {
            let credential = EmailAuthProvider.credential(withEmail: self.email, password: self.password)
            if let user = Auth.auth().currentUser, user.isAnonymous {
                try await user.link(with: credential)
            } else {
                try await Auth.auth().createUser(withEmail: self.email, password: self.password)
            }
        }
    }

    func logout() async {
        await perform {
            // Remove this device's push registrations first, while the user is still signed in.
            try await Clayver.logout()
            try Auth.auth().signOut()
        }
    }

    private func perform(_ action: @escaping () async throws -> Void) async {
        busy = true
        defer { busy = false }
        do {
            try await action()
            password = ""
            if let user = Auth.auth().currentUser, !user.isAnonymous {
                try await Clayver.setUserProperties([
                    Clayver.UserProperty.name: .string(user.displayName ?? user.email?.components(separatedBy: "@").first ?? ""),
                    // Your own user id; the example has none, so it reuses the Firebase uid.
                    Clayver.UserProperty.uid: .string(user.uid),
                    "plan": "pro",
                ])
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var session: SessionModel
    @ObservedObject private var push = PushRegistration.shared
    @State private var unread = 0
    @State private var showChat = false
    /// Agent mode: whether the signed-in user holds an agent/admin role (ID token claim).
    @State private var agentRole: ClayverAgentRole?
    @State private var showSwiftUIInbox = false

    var body: some View {
        NavigationView {
            Form {
                Section("Account") {
                    if let email = session.loggedInAs {
                        Text("Signed in as \(email)")
                        Button("Log out") { Task { await session.logout() } }
                    } else {
                        TextField("Email", text: $session.email)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .autocapitalization(.none)
                        SecureField("Password", text: $session.password)
                            .textContentType(.password)
                        Button("Log in") { Task { await session.signIn() } }
                            .disabled(session.email.isEmpty || session.password.isEmpty || session.busy)
                        Button("Create account") { Task { await session.signUp() } }
                            .disabled(session.email.isEmpty || session.password.isEmpty || session.busy)
                    }
                }

                Section("Support") {
                    // Presents `ClayverSupportView` (what `Clayver.openChat()` shows) in a SwiftUI
                    // sheet: the conversation list with the chat pushed on top, so the chat has a
                    // back button to the list and Close on the right. From UIKit code, call
                    // `Clayver.openChat()` instead.
                    Button {
                        showChat = true
                    } label: {
                        HStack {
                            Label("Contact support", systemImage: "questionmark.bubble")
                            Spacer()
                            if unread > 0 {
                                Text("\(unread)")
                                    .font(.caption.bold())
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 2)
                                    .background(Capsule().fill(Color.red))
                                    .accessibilityLabel("\(unread) unread")
                            }
                        }
                    }
                }

                Section("Push notifications") {
                    // Requests notification permission and registers with APNs; the AppDelegate
                    // passes the token to `Clayver.setPushToken(_:)`. The Clayver chat also shows
                    // a banner asking for permission while notifications are off.
                    Button {
                        Task { await push.register() }
                    } label: {
                        HStack {
                            Label("Register for push notifications", systemImage: "bell.badge")
                            Spacer()
                            Text(push.status.label)
                                .font(.caption)
                                .foregroundColor(push.status == .registered ? .green : .secondary)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                }

                // Agent mode: only shown to users an admin granted a role to (dashboard or
                // `clayver admin grant --email <email>`). The database rules are the authority;
                // the role from the ID token only decides whether to show these buttons.
                if let agentRole {
                    Section("Support team (\(agentRole.rawValue))") {
                        Button {
                            Clayver.openAgentInbox()
                        } label: {
                            Label("Agent inbox", systemImage: "tray.full")
                        }
                        Button("Agent inbox in a SwiftUI sheet") { showSwiftUIInbox = true }
                    }
                }

                Section {
                    // Picks up a role granted (or revoked) while the app is running.
                    Button("Refresh support role") {
                        Task { agentRole = try? await Clayver.agentRole(forceRefresh: true) }
                    }
                }
            }
            .navigationTitle("Clayver Example")
        }
        .sheet(isPresented: $showChat) {
            ClayverSupportView(onClose: { showChat = false })
        }
        .sheet(isPresented: $showSwiftUIInbox) {
            NavigationView {
                ClayverAgentInboxView(onClose: { showSwiftUIInbox = false })
            }
            .navigationViewStyle(.stack)
        }
        .task(id: session.loggedInAs) {
            // A fresh sign-in carries a fresh ID token, so a role granted to this account
            // applies right after login. Logged-out (anonymous) users are never agents.
            agentRole = try? await Clayver.agentRole()
        }
        .task(id: session.loggedInAs) {
            // Re-subscribe when the signed-in user changes; the stream's Firebase listener is
            // removed automatically when this task is cancelled.
            do {
                for try await count in Clayver.unreadCountUpdates() {
                    unread = count
                }
            } catch {
                print("Unread updates stopped: \(error.localizedDescription)")
            }
        }
        .alert("Error", isPresented: Binding(
            get: { session.errorMessage != nil },
            set: { if !$0 { session.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(session.errorMessage ?? "")
        }
    }
}
