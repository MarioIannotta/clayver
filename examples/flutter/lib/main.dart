import 'dart:async';
import 'dart:io' show Platform;

import 'package:clayver/clayver.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';

import 'firebase_options.dart';

/// Runs in a background isolate for data messages. Clayver pushes carry a
/// `notification` block, so the OS displays them without any work here; the
/// handler only shows how to tell them apart from the app's own pushes.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  if (Clayver.isClayverNotification(message.data)) return;
  // Handle the app's own data messages here.
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Clayver uses the native default Firebase app that firebase_core creates.
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

  await Clayver.configure(
    options: const ClayverOptions(
      // projectId: 'default', functionsRegion: 'us-central1',
      theme: ClayverTheme(accentColor: Color(0xFF4F46E5)),
    ),
  );

  runApp(const ExampleApp());
}

class ExampleApp extends StatelessWidget {
  const ExampleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Clayver example',
      theme: ThemeData(colorSchemeSeed: const Color(0xFF4F46E5)),
      home: const HomePage(),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final TextEditingController _name = TextEditingController(
    text: 'Ada Lovelace',
  );
  final List<StreamSubscription<Object?>> _subscriptions = [];
  String _pushStatus = 'Push not registered';
  StreamSubscription<String>? _tokenRefresh;

  /// The signed-in Firebase user, or null while signed out or anonymous.
  /// Clayver follows the Firebase user on its own: the customer id is its uid.
  User? _user;

  /// Whether the signed-in user is an agent or admin of the workspace. Agents
  /// can answer customers from the app (agent mode).
  bool _isAgent = false;

  @override
  void initState() {
    super.initState();
    _setUpPush();
    _subscriptions.add(
      FirebaseAuth.instance.authStateChanges().listen((User? user) {
        setState(() => _user = (user == null || user.isAnonymous) ? null : user);
        // A fresh sign-in carries a fresh ID token, so a granted role shows up
        // right away. Signed-out (anonymous) users are never agents.
        _refreshAgentRole();
      }),
    );
  }

  /// Agent features are shown only when the ID token carries a role
  /// for this workspace. The database rules still check every agent action.
  /// [forceRefresh] picks up a role granted or revoked while the app runs.
  Future<void> _refreshAgentRole({bool forceRefresh = false}) async {
    bool isAgent;
    try {
      if (forceRefresh) await Clayver.agentRole(forceRefresh: true);
      isAgent = await Clayver.isAgent();
    } on ClayverException {
      isAgent = false;
    }
    if (mounted) setState(() => _isAgent = isAgent);
  }

  @override
  void dispose() {
    for (final StreamSubscription<Object?> s in _subscriptions) {
      s.cancel();
    }
    _tokenRefresh?.cancel();
    _email.dispose();
    _password.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _setUpPush() async {
    final FirebaseMessaging messaging = FirebaseMessaging.instance;

    // Taps on a notification while the app is in the background...
    _subscriptions.add(
      FirebaseMessaging.onMessageOpenedApp.listen(
        (RemoteMessage m) => Clayver.handleNotification(m.data),
      ),
    );
    // ...or that launched the app.
    final RemoteMessage? initial = await messaging.getInitialMessage();
    if (initial != null) await Clayver.handleNotification(initial.data);

    // iOS: show Clayver pushes while the app is in the foreground too.
    await messaging.setForegroundNotificationPresentationOptions(
      alert: true,
      badge: true,
      sound: true,
    );
  }

  /// Asks for permission (iOS, Android 13+), then registers the FCM token.
  Future<void> _registerPush() async {
    final FirebaseMessaging messaging = FirebaseMessaging.instance;
    final NotificationSettings settings = await messaging.requestPermission();
    if (settings.authorizationStatus == AuthorizationStatus.denied) {
      setState(() => _pushStatus = 'Notification permission denied');
      return;
    }
    if (Platform.isIOS) {
      // FCM can only mint a token once APNs has delivered the device token.
      String? apns = await messaging.getAPNSToken();
      for (int i = 0; apns == null && i < 10; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 500));
        apns = await messaging.getAPNSToken();
      }
      if (apns == null) {
        setState(
          () => _pushStatus =
              'No APNs token (simulator or missing '
              'Push Notifications capability?)',
        );
        return;
      }
    }
    // Clayver sends through FCM registration tokens (the `devices/*/pushToken`
    // field). firebase_messaging 17 deprecates getToken/onTokenRefresh in
    // favor of register()/onRegistered, which report a Firebase Installation
    // ID for FCM direct-send instead; Clayver does not use that yet.
    // ignore: deprecated_member_use
    final String? token = await messaging.getToken();
    if (token == null) return;
    await _run(() => Clayver.setPushToken(token), 'Push token registered');
    // Listen once, however many times the button is tapped.
    // ignore: deprecated_member_use
    _tokenRefresh ??= messaging.onTokenRefresh.listen(Clayver.setPushToken);
    if (mounted) setState(() => _pushStatus = 'Push registered');
  }

  Future<void> _run(Future<void> Function() action, String done) async {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    try {
      await action();
      messenger.showSnackBar(SnackBar(content: Text(done)));
    } on ClayverException catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text('Clayver error ${e.code}: ${e.message}')),
      );
    } on FirebaseAuthException catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text('Sign-in error ${e.code}: ${e.message}')),
      );
    }
  }

  Future<void> _signIn() => _run(
    () => FirebaseAuth.instance.signInWithEmailAndPassword(
      email: _email.text.trim(),
      password: _password.text,
    ),
    'Signed in',
  );

  /// Linking the anonymous user keeps its uid, so conversations started
  /// before sign-up stay with the new account.
  Future<void> _signUp() => _run(() async {
    final String email = _email.text.trim();
    final User? current = FirebaseAuth.instance.currentUser;
    if (current != null && current.isAnonymous) {
      await current.linkWithCredential(
        EmailAuthProvider.credential(email: email, password: _password.text),
      );
    } else {
      await FirebaseAuth.instance.createUserWithEmailAndPassword(
        email: email,
        password: _password.text,
      );
    }
  }, 'Account created');

  /// Removes this device's push registrations while the user is still signed
  /// in, then signs out of Firebase Auth.
  Future<void> _logOut() => _run(() async {
    await Clayver.logout();
    await FirebaseAuth.instance.signOut();
  }, 'Logged out');

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Clayver example'),
        actions: [
          StreamBuilder<int>(
            stream: Clayver.unreadCountStream,
            builder: (BuildContext context, AsyncSnapshot<int> snapshot) {
              final int unread = snapshot.data ?? 0;
              return IconButton(
                tooltip: 'Support',
                onPressed: () => Clayver.openChat(),
                icon: Badge(
                  isLabelVisible: unread > 0,
                  label: Text('$unread'),
                  child: const Icon(Icons.support_agent),
                ),
              );
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('1. Log in', style: Theme.of(context).textTheme.titleMedium),
          if (_user != null) ...[
            Text('Signed in as ${_user!.email ?? _user!.uid}'),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: _logOut, child: const Text('Log out')),
          ] else ...[
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Email'),
            ),
            TextField(
              controller: _password,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Password'),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                FilledButton(onPressed: _signIn, child: const Text('Log in')),
                FilledButton.tonal(
                  onPressed: _signUp,
                  child: const Text('Create account'),
                ),
              ],
            ),
          ],
          const Divider(height: 32),
          Text(
            '2. Customer properties',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Name'),
          ),
          const SizedBox(height: 8),
          FilledButton.tonal(
            onPressed: () => _run(
              () => Clayver.setUserProperties({
                Clayver.userProperty.name: _name.text,
                'plan': 'pro',
                'seats': 5,
                'beta': true,
              }),
              'Properties saved',
            ),
            child: const Text('Save properties'),
          ),
          const Divider(height: 32),
          Text(
            '3. Push notifications',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          Text(_pushStatus),
          const SizedBox(height: 8),
          FilledButton.tonal(
            onPressed: _registerPush,
            child: const Text('Register for push notifications'),
          ),
          const Divider(height: 32),
          Text('4. Chat', style: Theme.of(context).textTheme.titleMedium),
          StreamBuilder<int>(
            stream: Clayver.unreadCountStream,
            builder: (BuildContext context, AsyncSnapshot<int> snapshot) {
              if (snapshot.hasError) {
                return Text('Unread count unavailable: ${snapshot.error}');
              }
              return Text('Unread messages: ${snapshot.data ?? 0}');
            },
          ),
          const SizedBox(height: 8),
          // The customer's unread count as a badge on the button that opens
          // the chat, shown only when there is something unread.
          StreamBuilder<int>(
            stream: Clayver.unreadCountStream,
            builder: (BuildContext context, AsyncSnapshot<int> snapshot) {
              final int unread = snapshot.data ?? 0;
              return Align(
                alignment: AlignmentDirectional.centerStart,
                child: Badge(
                  isLabelVisible: unread > 0,
                  label: Text(unread > 99 ? '99+' : '$unread'),
                  child: FilledButton.icon(
                    onPressed: () => _run(Clayver.openChat, 'Chat opened'),
                    icon: const Icon(Icons.chat_bubble_outline),
                    label: const Text('Open chat'),
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.tonalIcon(
                onPressed: () =>
                    _run(Clayver.openConversations, 'Conversations opened'),
                icon: const Icon(Icons.forum_outlined),
                label: const Text('Conversations'),
              ),
              FilledButton.tonalIcon(
                onPressed: () => _run(
                  Clayver.openNewConversation,
                  'New conversation opened',
                ),
                icon: const Icon(Icons.add_comment_outlined),
                label: const Text('New conversation'),
              ),
            ],
          ),
          if (_isAgent) ...[
            const Divider(height: 32),
            Text(
              '5. Agent mode',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const Text('You can answer customers from this app.'),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: () => _run(Clayver.openAgentInbox, 'Inbox opened'),
              icon: const Icon(Icons.inbox_outlined),
              label: const Text('Agent inbox'),
            ),
          ],
          const SizedBox(height: 8),
          TextButton(
            onPressed: () => _refreshAgentRole(forceRefresh: true),
            child: const Text('Check agent role'),
          ),
        ],
      ),
    );
  }
}
