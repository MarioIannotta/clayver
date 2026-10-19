# Identity

Clayver uses the Firebase Authentication of your app's Firebase project for
everyone: your customers and your support agents. There is no Clayver login,
no shared secret and no extra backend to host.

## Customers

Sign users in with Firebase Auth as you normally would (email and password,
Apple, Google, phone, a custom token from your own server, and so on). The SDK
follows the signed-in Firebase user:

- the customer id is the Firebase uid, so every device signed in to the same
  account shares conversations, unread counts and push registrations;
- when the user changes, this device's push registration moves to the new uid
  (Android flows switch to the new user too; on iOS, re-create streams, for
  example with `.task(id: uid)`);
- with no signed-in user, the SDK signs in anonymously so people can chat before
  they log in. Turn that off with `ClayverOptions(signInAnonymously: false)`;
  SDK calls then fail with `notAuthenticated` until your app signs someone in.

```swift
try await Clayver.configure()
try await Auth.auth().signIn(withEmail: email, password: password)
// Clayver now chats as this user. Optional context for agents: the
// Clayver.UserProperty keys are shown as the customer's name, email and user id.
try await Clayver.setUserProperties([
    Clayver.UserProperty.name: .string(name),
    Clayver.UserProperty.uid: .string(myUserId),
    "plan": "pro",
])
```

### Keeping chats started before login

An anonymous user who creates an account keeps their conversations when you
link the new credential to the anonymous user instead of creating a separate
account. The uid stays the same:

```swift
let credential = EmailAuthProvider.credential(withEmail: email, password: password)
if let user = Auth.auth().currentUser, user.isAnonymous {
    try await user.link(with: credential)
} else {
    try await Auth.auth().createUser(withEmail: email, password: password)
}
```

Android: `currentUser.linkWithCredential(credential)`. Flutter:
`FirebaseAuth.instance.currentUser!.linkWithCredential(credential)`.

Signing in to an *existing* account switches to that account's uid. The
anonymous conversations stay with the anonymous user and are not merged.

### Signing out

Call `Clayver.logout()` right before you sign the user out:

```swift
try await Clayver.logout()   // removes this device's push registrations
try Auth.auth().signOut()
```

`logout()` must run while the user is still signed in, because removing the
registration is a write as that user. It signs out an anonymous user itself,
but never your own signed-in user.

### What agents see

When a customer opens a conversation, the `onConversationCreated` function
records a read-only snapshot of their Firebase account under
`users/{cid}/account`: `anonymous`, `email`, `emailVerified` and `displayName`.
The dashboard and the in-app agent views show it next to the customer's
properties. Clients can't write it.

## Agents

Agents are Firebase Auth accounts in the same project. An admin grants a role
by email or uid, from the dashboard's Team page or the CLI:

```sh
npx clayver admin grant --email agent@example.com --role agent
npx clayver admin grant --uid <firebase uid> --role admin
```

A grant creates `agents/{uid}` (checked by the database rules) and sets the
`clayver_roles` custom claim (checked by the Storage rules and used by the SDKs
to decide whether to show agent features). A fresh sign-in picks up the role;
an app that is already signed in can call `agentRole(forceRefresh: true)`.

For an email that has no account yet, the dashboard creates the account and
returns a password-setup link for the admin to share; the CLI does the same
with `--create`.

Revoking a role deactivates the agent record, removes the claim and revokes the
account's refresh tokens, which signs that account out on every device,
including your own app if the agent uses it as a customer too.
