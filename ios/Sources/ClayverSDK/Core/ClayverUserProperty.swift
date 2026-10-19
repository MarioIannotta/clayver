import Foundation

extension Clayver {
    /// Keys of user properties that the support UI understands: the dashboard and the agent
    /// views show them as the customer's name, email and user id instead of listing them with
    /// the other properties. Their values must be strings.
    ///
    /// ```swift
    /// try await Clayver.setUserProperties([
    ///     Clayver.UserProperty.name: .string(name),
    ///     Clayver.UserProperty.uid: .string(user.id),
    ///     "plan": "pro",
    /// ])
    /// ```
    ///
    /// Other keys can't start with `_`, so they never collide with these.
    public enum UserProperty {
        /// The customer's name, used to label them in the inbox and the conversation.
        public static let name = "_name"
        /// The customer's email address, shown instead of the Firebase Auth email.
        public static let email = "_email"
        /// Your app's own id for the user (for example its database id), shown as "User ID".
        public static let uid = "_uid"

        /// Every reserved key.
        public static let all: Set<String> = [name, email, uid]
    }
}
