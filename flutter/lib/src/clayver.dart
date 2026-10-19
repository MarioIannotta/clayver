import 'dart:async';

import 'package:flutter/foundation.dart';

import 'exception.dart';
import 'messages.g.dart' as pigeon;
import 'models.dart';

/// Entry point of the Clayver Flutter plugin.
///
/// Every method forwards to the native Clayver SDK (`ClayverSDK` on iOS,
/// `com.clayver.sdk.Clayver` on Android). Messaging, push registration and the
/// chat UI are implemented natively; this class only converts arguments,
/// results and errors. Every failure is a [ClayverException].
abstract final class Clayver {
  /// Keys of user properties that the support UI understands. See
  /// [ClayverUserProperties].
  static const ClayverUserProperties userProperty = ClayverUserProperties._();

  static pigeon.ClayverHostApi _api = pigeon.ClayverHostApi();
  static _SharedNativeStream<int>? _unread;
  static _SharedNativeStream<List<ClayverConversation>>? _conversations;
  static _SharedNativeStream<ClayverBlockStatus?>? _blockStatus;
  static _SharedNativeStream<List<ClayverTag>>? _tags;
  static final Map<String, _SharedNativeStream<List<ClayverMessage>>>
  _messageStreams = {};
  static final Map<String, _SharedNativeStream<List<ClayverAgentConversation>>>
  _agentConversationStreams = {};
  static final Map<String, _SharedNativeStream<ClayverCustomerProfile>>
  _profileStreams = {};
  static final Map<String, _SharedNativeStream<List<String>>>
  _conversationTagStreams = {};
  static int _nextMessagesChannel = 0;
  static int _nextAgentConversationsChannel = 0;
  static int _nextProfileChannel = 0;
  static int _nextConversationTagsChannel = 0;

  /// Replaces the Pigeon host API (tests only).
  @visibleForTesting
  static set hostApi(pigeon.ClayverHostApi api) => _api = api;

  /// Drops cached streams and restores the real host API (tests only).
  @visibleForTesting
  static void resetForTesting() {
    _api = pigeon.ClayverHostApi();
    _unread = null;
    _conversations = null;
    _blockStatus = null;
    _tags = null;
    _messageStreams.clear();
    _agentConversationStreams.clear();
    _profileStreams.clear();
    _conversationTagStreams.clear();
    _nextMessagesChannel = 0;
    _nextAgentConversationsChannel = 0;
    _nextProfileChannel = 0;
    _nextConversationTagsChannel = 0;
  }

  static Future<T> _call<T>(Future<T> Function() body) async {
    try {
      return await body();
    } catch (e, st) {
      Error.throwWithStackTrace(mapClayverError(e), st);
    }
  }

  /// Initializes the native SDK. Call once, after `Firebase.initializeApp()`,
  /// before any other Clayver API.
  static Future<void> configure({ClayverOptions? options}) =>
      _call(() => _api.configure((options ?? const ClayverOptions()).toDto()));

  /// Removes this device's push registrations for the signed-in user. Call it
  /// right before you sign the user out of Firebase Auth, so a signed-out
  /// device stops getting their notifications. An anonymous user is signed out
  /// by the SDK; your own signed-in user is not (call
  /// `FirebaseAuth.instance.signOut()` yourself).
  static Future<void> logout() => _call(_api.logout);

  /// Erases everything Clayver stores for the current customer
  /// (conversations, messages, attachments, profile, push registrations) with
  /// the `clayverDeleteMyData` function, then logs out. Call it from your
  /// app's account deletion flow.
  static Future<void> deleteCustomerData() => _call(_api.deleteCustomerData);

  /// Sets customer properties shown to agents. Use the [userProperty] keys for
  /// the customer's name, email and user id, which are shown specially; other
  /// keys match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. Values must be [String],
  /// [int], [double] or [bool]; anything else fails with
  /// [ClayverErrorCode.invalidArgument].
  static Future<void> setUserProperties(Map<String, Object> properties) {
    for (final MapEntry<String, Object> entry in properties.entries) {
      final Object value = entry.value;
      final bool ok =
          value is String ||
          value is bool ||
          value is int ||
          (value is double && value.isFinite);
      if (!ok) {
        return Future<void>.error(
          ClayverException(
            ClayverErrorCode.invalidArgument,
            'Property "${entry.key}" has unsupported value type '
            '${value.runtimeType}; use String, int, double or bool.',
          ),
        );
      }
    }
    return _call(() => _api.setUserProperties(properties));
  }

  /// Registers the device for Clayver push notifications with the FCM
  /// registration token (`FirebaseMessaging.instance.getToken()`) on both
  /// platforms. Call it again from `onTokenRefresh`.
  static Future<void> setPushToken(String token) =>
      _call(() => _api.setPushToken(token));

  /// Deactivates this device's push registration.
  static Future<void> clearPushToken() => _call(_api.clearPushToken);

  /// Total unread agent/system messages of the customer.
  static Future<int> getUnreadMessagesCount() =>
      _call(_api.getUnreadMessagesCount);

  /// Live unread count. Emits the current value on listen, then every change.
  /// Several listeners share one native listener.
  static Stream<int> get unreadCountStream =>
      (_unread ??= _SharedNativeStream<int>(() => pigeon.unreadCount())).stream;

  /// Opens the native chat UI, optionally on [conversationId].
  /// iOS presents it modally over the top-most view controller; Android starts
  /// the chat Activity from the plugin's attached Activity.
  ///
  /// Without [conversationId], and with
  /// [ClayverOptions.multipleConversations] on (the default), it opens the
  /// conversation list when the customer has a conversation, else a new empty
  /// chat. With it off, it opens the latest conversation (or a new one).
  static Future<void> openChat({String? conversationId}) =>
      _call(() => _api.openChat(conversationId));

  /// Opens the native conversation list (newest first, with a "New
  /// conversation" button), whatever [ClayverOptions.multipleConversations]
  /// says.
  static Future<void> openConversations() => _call(_api.openConversations);

  /// Opens a new, empty native chat. The conversation is created when the
  /// first message is sent.
  static Future<void> openNewConversation() => _call(_api.openNewConversation);

  /// Handles a notification tap: if [data] is a Clayver push, opens the
  /// conversation and returns `true`; otherwise returns `false`.
  /// Pushes with `audience: "customer"` open the customer chat; pushes with
  /// `audience: "agent"` (sent to agent devices) open the native agent inbox
  /// on that conversation. Routing is done by the native SDK.
  /// Pass `RemoteMessage.data` from `firebase_messaging`.
  static Future<bool> handleNotification(Map<String, dynamic> data) =>
      _call(() => _api.handleNotification(_stringMap(data)));

  /// Whether [data] (`RemoteMessage.data`) is a Clayver push. Pure Dart so it
  /// can be used synchronously, including in a background message handler.
  static bool isClayverNotification(Map<String, dynamic> data) =>
      data['clayver']?.toString() == '1';

  /// Live list of the customer's conversations, newest first.
  static Stream<List<ClayverConversation>> conversations() =>
      (_conversations ??= _SharedNativeStream<List<ClayverConversation>>(
        () => pigeon.conversations().map(
          (List<dynamic> list) => list
              .cast<pigeon.ClayverConversationDto>()
              .map(ClayverConversation.fromDto)
              .toList(growable: false),
        ),
      )).stream;

  /// Live list of the newest messages (chronological) of [conversationId].
  /// Use [loadOlderMessages] for history. Agents use the same stream for any
  /// conversation of the workspace.
  static Stream<List<ClayverMessage>> messages(String conversationId) =>
      _instanceStream<List<ClayverMessage>>(
        cache: _messageStreams,
        key: conversationId,
        nextName: () => 'm${_nextMessagesChannel++}',
        register: (String name) =>
            _api.registerMessagesChannel(name, conversationId),
        unregister: _api.unregisterMessagesChannel,
        open: (String name) => pigeon
            .messages(instanceName: name)
            .map(
              (List<dynamic> list) => list
                  .cast<pigeon.ClayverMessageDto>()
                  .map(ClayverMessage.fromDto)
                  .toList(growable: false),
            ),
      );

  /// A stream backed by its own Pigeon event channel instance, registered on
  /// the native side before listening and unregistered when the last Dart
  /// listener cancels (or the native stream ends). Listeners with the same
  /// [key] share one native listener.
  static Stream<T> _instanceStream<T>({
    required Map<String, _SharedNativeStream<T>> cache,
    required String key,
    required String Function() nextName,
    required Future<void> Function(String name) register,
    required Future<void> Function(String name) unregister,
    required Stream<T> Function(String name) open,
  }) {
    return cache.putIfAbsent(key, () {
      late final _SharedNativeStream<T> shared;
      String? channel;
      shared = _SharedNativeStream<T>(
        () async* {
          final String name = nextName();
          channel = name;
          await register(name);
          yield* open(name);
        },
        onIdle: () {
          if (identical(cache[key], shared)) cache.remove(key);
          final String? name = channel;
          channel = null;
          if (name != null) unregister(name).catchError((Object _) {});
        },
      );
      return shared;
    }).stream;
  }

  /// Loads up to [limit] messages older than the message [before] (typically
  /// the oldest id received from [messages]), in chronological order.
  static Future<List<ClayverMessage>> loadOlderMessages(
    String conversationId, {
    required String before,
    int limit = 30,
  }) => _call(() async {
    final List<pigeon.ClayverMessageDto> dtos = await _api.loadOlderMessages(
      conversationId,
      before,
      limit,
    );
    return dtos.map(ClayverMessage.fromDto).toList(growable: false);
  });

  /// Sends a message. Without [conversationId] the SDK reuses the customer's
  /// open conversation or creates one. At least one of [text] or [attachment]
  /// is required.
  static Future<ClayverMessage> sendMessage({
    String? text,
    String? conversationId,
    ClayverAttachmentInput? attachment,
  }) => _call(
    () async => ClayverMessage.fromDto(
      await _api.sendMessage(text, conversationId, attachment?.toDto()),
    ),
  );

  /// Starts a new conversation with this first message, even when the
  /// customer already has an open one. The returned message carries the new
  /// conversation id. At least one of [text] or [attachment] is required.
  static Future<ClayverMessage> startConversation({
    String? text,
    ClayverAttachmentInput? attachment,
  }) => _call(
    () async => ClayverMessage.fromDto(
      await _api.startConversation(text, attachment?.toDto()),
    ),
  );

  /// Live block state of the customer: a [ClayverBlockStatus] while an agent
  /// block is active, else `null`. A timed block turns into `null` by itself
  /// when it ends. Several listeners share one native listener.
  static Stream<ClayverBlockStatus?> blockStatus() =>
      (_blockStatus ??= _SharedNativeStream<ClayverBlockStatus?>(
        () => pigeon.blockStatus().map((pigeon.ClayverBlockStateDto state) {
          final pigeon.ClayverBlockStatusDto? status = state.status;
          return status == null ? null : ClayverBlockStatus.fromDto(status);
        }),
      )).stream;

  /// Marks [id] read for the customer (updates the read receipt and the
  /// unread counters).
  static Future<void> markConversationRead(String id) =>
      _call(() => _api.markConversationRead(id));

  // Agent mode.

  /// The signed-in user's support role in the configured workspace, or
  /// `null` for customers. Read natively from the verified ID token claim
  /// `clayver_roles[projectId]`. Pass [forceRefresh] to pick up a grant or
  /// revocation made while the app runs (a new sign-in already refreshes).
  static Future<ClayverAgentRole?> agentRole({bool forceRefresh = false}) =>
      _call(
        () async => ClayverAgentRole.parse(await _api.agentRole(forceRefresh)),
      );

  /// Whether the signed-in user is an agent or admin of the workspace. Use it
  /// to decide whether to show agent features such as [openAgentInbox].
  static Future<bool> isAgent() => _call(_api.isAgent);

  /// Opens the native agent inbox, straight on [conversationId] when given.
  /// Users without a role see a "no access" screen.
  static Future<void> openAgentInbox({String? conversationId}) =>
      _call(() => _api.openAgentInbox(conversationId));

  /// Live list of the workspace's conversations with [status], newest
  /// activity first, at most [limit]. With [tagId], only the conversations
  /// carrying that tag. Fails with [ClayverErrorCode.permissionDenied] for
  /// users without an agent role. Listeners with the same [status], [limit]
  /// and [tagId] share one native listener.
  static Stream<List<ClayverAgentConversation>> agentConversations({
    ClayverConversationStatus status = ClayverConversationStatus.open,
    int limit = 50,
    String? tagId,
  }) {
    final String? wire = _statusWire(status);
    if (wire == null) {
      return Stream<List<ClayverAgentConversation>>.error(
        _invalidStatus(status),
      );
    }
    if (limit <= 0) {
      return Stream<List<ClayverAgentConversation>>.error(
        ClayverException(
          ClayverErrorCode.invalidArgument,
          'limit must be positive, got $limit.',
        ),
      );
    }
    return _instanceStream<List<ClayverAgentConversation>>(
      cache: _agentConversationStreams,
      key: tagId == null ? '$wire:$limit' : '$wire:$limit:$tagId',
      nextName: () => 'a${_nextAgentConversationsChannel++}',
      register: (String name) =>
          _api.registerAgentConversationsChannel(name, wire, limit, tagId),
      unregister: _api.unregisterAgentConversationsChannel,
      open: (String name) => pigeon
          .agentConversations(instanceName: name)
          .map(
            (List<dynamic> list) => list
                .cast<pigeon.ClayverAgentConversationDto>()
                .map(ClayverAgentConversation.fromDto)
                .toList(growable: false),
          ),
    );
  }

  /// Live profile of a customer (`users/{customerId}`). Agents only.
  static Stream<ClayverCustomerProfile> customerProfile(String customerId) =>
      _instanceStream<ClayverCustomerProfile>(
        cache: _profileStreams,
        key: customerId,
        nextName: () => 'p${_nextProfileChannel++}',
        register: (String name) =>
            _api.registerCustomerProfileChannel(name, customerId),
        unregister: _api.unregisterCustomerProfileChannel,
        open: (String name) => pigeon
            .customerProfile(instanceName: name)
            .map(ClayverCustomerProfile.fromDto),
      );

  /// Replies in [conversationId] as the signed-in agent (`senderType:
  /// "agent"`, `senderName` from the agent record). At least one of [text] or
  /// [attachment] is required.
  static Future<ClayverMessage> sendAgentReply({
    required String conversationId,
    String? text,
    ClayverAttachmentInput? attachment,
  }) => _call(
    () async => ClayverMessage.fromDto(
      await _api.sendAgentReply(conversationId, text, attachment?.toDto()),
    ),
  );

  /// Opens or closes a conversation. [status] must be
  /// [ClayverConversationStatus.open] or [ClayverConversationStatus.closed].
  static Future<void> setConversationStatus(
    String id,
    ClayverConversationStatus status,
  ) {
    final String? wire = _statusWire(status);
    if (wire == null) return Future<void>.error(_invalidStatus(status));
    return _call(() => _api.setConversationStatus(id, wire));
  }

  /// Assigns the conversation to the signed-in agent ([toMe] `true`) or
  /// removes the assignee.
  static Future<void> assignConversation(String id, {required bool toMe}) =>
      _call(() => _api.assignConversation(id, toMe));

  /// Moves the team's shared read marker (`reads/{id}/agent`) to now.
  static Future<void> markConversationReadAsAgent(String id) =>
      _call(() => _api.markConversationReadAsAgent(id));

  /// Live tag catalog of the workspace, sorted by name. Agents only. Several
  /// listeners share one native listener.
  static Stream<List<ClayverTag>> tags() =>
      (_tags ??= _SharedNativeStream<List<ClayverTag>>(
        () => pigeon.tags().map(
          (List<dynamic> list) => list
              .cast<pigeon.ClayverTagDto>()
              .map(ClayverTag.fromDto)
              .toList(growable: false),
        ),
      )).stream;

  /// Creates a tag whose id is the slug of [name], or returns the existing
  /// tag with that id. Without [color] (`#rrggbb`) the palette color chosen
  /// by the slug is used. Agents only.
  static Future<ClayverTag> createTag(String name, {String? color}) =>
      _call(() async => ClayverTag.fromDto(await _api.createTag(name, color)));

  /// Live ids of the tags on [conversationId]. Agents only. Listeners of the
  /// same conversation share one native listener.
  static Stream<List<String>> conversationTags(String conversationId) =>
      _instanceStream<List<String>>(
        cache: _conversationTagStreams,
        key: conversationId,
        nextName: () => 't${_nextConversationTagsChannel++}',
        register: (String name) =>
            _api.registerConversationTagsChannel(name, conversationId),
        unregister: _api.unregisterConversationTagsChannel,
        open: (String name) => pigeon
            .conversationTags(instanceName: name)
            .map(
              (List<dynamic> list) =>
                  List<String>.unmodifiable(list.cast<String>()),
            ),
      );

  /// Puts the tag [tagId] (which must exist, see [createTag]) on
  /// [conversationId]. Agents only.
  static Future<void> addTag(String conversationId, String tagId) =>
      _call(() => _api.addTag(conversationId, tagId));

  /// Takes the tag [tagId] off [conversationId]. Agents only.
  static Future<void> removeTag(String conversationId, String tagId) =>
      _call(() => _api.removeTag(conversationId, tagId));

  static String? _statusWire(ClayverConversationStatus status) =>
      switch (status) {
        ClayverConversationStatus.open => 'open',
        ClayverConversationStatus.closed => 'closed',
        ClayverConversationStatus.unknown => null,
      };

  static ClayverException _invalidStatus(ClayverConversationStatus status) =>
      ClayverException(
        ClayverErrorCode.invalidArgument,
        'Conversation status must be open or closed, got ${status.name}.',
      );

  static Map<String, String> _stringMap(Map<String, dynamic> data) => {
    for (final MapEntry<String, dynamic> e in data.entries)
      if (e.value != null) e.key: e.value.toString(),
  };
}

/// One native listener shared by any number of Dart listeners. New listeners
/// immediately receive the latest value. The native listener starts with the
/// first Dart listener and is cancelled when the last one cancels. Errors are
/// mapped to [ClayverException]; when the native stream ends (after an error),
/// every listener is closed and the next listen starts a fresh native stream.
class _SharedNativeStream<T> {
  _SharedNativeStream(this._open, {this.onIdle});

  final Stream<T> Function() _open;
  final void Function()? onIdle;
  final Set<MultiStreamController<T>> _listeners = {};
  StreamSubscription<T>? _subscription;
  T? _latest;
  bool _hasLatest = false;

  Stream<T> get stream => Stream<T>.multi((MultiStreamController<T> c) {
    _listeners.add(c);
    if (_hasLatest) c.add(_latest as T);
    c.onCancel = () {
      if (_listeners.remove(c) && _listeners.isEmpty) return _stop();
      return null;
    };
    _subscription ??= _open().listen(
      (T value) {
        _latest = value;
        _hasLatest = true;
        for (final MultiStreamController<T> l in _listeners.toList()) {
          l.addSync(value);
        }
      },
      onError: (Object error, StackTrace st) {
        final ClayverException mapped = mapClayverError(error);
        for (final MultiStreamController<T> l in _listeners.toList()) {
          l.addErrorSync(mapped, st);
        }
      },
      onDone: () {
        final List<MultiStreamController<T>> all = _listeners.toList();
        _listeners.clear();
        _reset();
        for (final MultiStreamController<T> l in all) {
          l.closeSync();
        }
        onIdle?.call();
      },
    );
  });

  void _reset() {
    _subscription = null;
    _latest = null;
    _hasLatest = false;
  }

  Future<void> _stop() {
    final StreamSubscription<T>? sub = _subscription;
    _reset();
    onIdle?.call();
    return sub?.cancel() ?? Future<void>.value();
  }
}

/// Keys of user properties that the support UI understands: the dashboard and
/// the agent screens show them as the customer's name, email and user id
/// instead of listing them with the other properties. Their values must be
/// strings. Other keys can't start with `_`, so they never collide with these.
///
/// ```dart
/// await Clayver.setUserProperties({
///   Clayver.userProperty.name: name,
///   Clayver.userProperty.uid: user.id,
///   'plan': 'pro',
/// });
/// ```
final class ClayverUserProperties {
  const ClayverUserProperties._();

  /// The customer's name, used to label them in the inbox and the conversation.
  String get name => '_name';

  /// The customer's email address, shown instead of the Firebase Auth email.
  String get email => '_email';

  /// Your app's own id for the user (for example its database id), shown as
  /// "User ID".
  String get uid => '_uid';

  /// Every reserved key.
  Set<String> get all => {name, email, uid};
}
