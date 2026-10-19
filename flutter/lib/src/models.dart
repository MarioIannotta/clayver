import 'dart:ui' show Color;

import 'package:flutter/foundation.dart';

import 'messages.g.dart';

/// Visual customization of the native chat UI opened by `Clayver.openChat`.
///
/// Every field is optional; unset fields keep the native SDK defaults (and the
/// workspace `config/public/accentColor`, if one is set).
@immutable
class ClayverTheme {
  /// Creates a theme.
  const ClayverTheme({
    this.title,
    this.accentColor,
    this.customerBubbleColor,
    this.customerTextColor,
    this.agentBubbleColor,
    this.agentTextColor,
    this.fontFamily,
  });

  /// Chat screen title. When `null`, the workspace `teamName` is used, then
  /// "Support".
  final String? title;

  /// Buttons, links and the send button.
  final Color? accentColor;

  /// Bubbles of messages the customer sent.
  final Color? customerBubbleColor;

  /// Text in the customer's bubbles.
  final Color? customerTextColor;

  /// Bubbles of agent and system messages.
  final Color? agentBubbleColor;

  /// Text in agent and system bubbles.
  final Color? agentTextColor;

  /// Name of a font bundled with the native app (iOS: PostScript or family
  /// name registered in Info.plist; Android: a font resource name in
  /// `res/font`). Flutter asset fonts are not visible to the native UI.
  final String? fontFamily;

  /// Converts to the bridge type.
  ClayverThemeDto toDto() => ClayverThemeDto(
    title: title,
    accentColor: accentColor?.toARGB32(),
    customerBubbleColor: customerBubbleColor?.toARGB32(),
    customerTextColor: customerTextColor?.toARGB32(),
    agentBubbleColor: agentBubbleColor?.toARGB32(),
    agentTextColor: agentTextColor?.toARGB32(),
    fontFamily: fontFamily,
  );
}

/// Points the SDK at the Firebase Local Emulator Suite. Debug builds only.
@immutable
class ClayverEmulator {
  /// Creates emulator settings with the Firebase CLI default ports.
  const ClayverEmulator({
    this.host,
    this.authPort = 9099,
    this.databasePort = 9000,
    this.functionsPort = 5001,
    this.storagePort = 9199,
  });

  /// Emulator host. `null` uses the native default: `localhost` on iOS and
  /// `10.0.2.2` (the host machine as seen from the Android emulator) on
  /// Android.
  final String? host;

  /// Auth emulator port.
  final int authPort;

  /// Realtime Database emulator port.
  final int databasePort;

  /// Functions emulator port.
  final int functionsPort;

  /// Storage emulator port.
  final int storagePort;

  /// Converts to the bridge type.
  ClayverEmulatorDto toDto() => ClayverEmulatorDto(
    host: host,
    authPort: authPort,
    databasePort: databasePort,
    functionsPort: functionsPort,
    storagePort: storagePort,
  );
}

/// Options passed to `Clayver.configure`. Same fields as the native
/// `ClayverOptions` on iOS and Android.
@immutable
class ClayverOptions {
  /// Creates options. All fields have defaults.
  const ClayverOptions({
    this.projectId = 'default',
    this.functionsRegion = 'us-central1',
    this.databaseURL,
    this.firebaseAppName,
    this.theme,
    this.emulator,
    this.multipleConversations = true,
    this.signInAnonymously = true,
  });

  /// The Clayver workspace (`^[a-z0-9-]{1,40}$`), default `default`.
  final String projectId;

  /// Region the Clayver Cloud Functions are deployed to.
  final String functionsRegion;

  /// URL of a non-default Realtime Database instance.
  final String? databaseURL;

  /// Name of a secondary native Firebase app; `null` uses the default app.
  final String? firebaseAppName;

  /// Chat UI theme.
  final ClayverTheme? theme;

  /// Firebase emulator settings (debug only).
  final ClayverEmulator? emulator;

  /// Whether a customer can have several conversations in the native UI
  /// (default `true`). When `true`, `Clayver.openChat()` without an id opens
  /// the conversation list if the customer has a conversation, and a new
  /// empty chat otherwise. When `false`, it opens the latest conversation (or
  /// a new one) and there is no list; `Clayver.openConversations` and
  /// `Clayver.openNewConversation` still work.
  final bool multipleConversations;

  /// Whether the native SDK signs in anonymously when no Firebase user is
  /// signed in, so visitors can chat before they log in (default `true`). Set
  /// it to `false` when your app requires sign-in: the SDK then waits for your
  /// Firebase Auth sign-in, and calls that need a customer throw
  /// `notAuthenticated` until a user is signed in.
  final bool signInAnonymously;

  /// Converts to the bridge type.
  ClayverOptionsDto toDto() => ClayverOptionsDto(
    projectId: projectId,
    functionsRegion: functionsRegion,
    databaseURL: databaseURL,
    firebaseAppName: firebaseAppName,
    theme: theme?.toDto(),
    emulator: emulator?.toDto(),
    multipleConversations: multipleConversations,
    signInAnonymously: signInAnonymously,
  );
}

/// Who sent a message.
enum ClayverSenderType {
  /// The app user.
  customer,

  /// A support agent.
  agent,

  /// Generated by Clayver (welcome message, status changes).
  system,

  /// A value this version of the plugin does not know.
  unknown;

  /// Parses the wire value, falling back to [unknown].
  static ClayverSenderType parse(String value) => switch (value) {
    'customer' => customer,
    'agent' => agent,
    'system' => system,
    _ => unknown,
  };
}

/// Conversation status.
enum ClayverConversationStatus {
  /// Waiting for or being handled by an agent.
  open,

  /// Closed by an agent. A new customer message reopens it.
  closed,

  /// A value this version of the plugin does not know.
  unknown;

  /// Parses the wire value, falling back to [unknown].
  static ClayverConversationStatus parse(String value) => switch (value) {
    'open' => open,
    'closed' => closed,
    _ => unknown,
  };
}

DateTime _ms(int ms) => DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true);

DateTime? _msOrNull(int? ms) => ms == null ? null : _ms(ms);

/// Summary of the newest message of a conversation.
@immutable
class ClayverLastMessage {
  /// Creates a summary.
  const ClayverLastMessage({
    required this.text,
    required this.senderType,
    required this.createdAt,
    required this.hasAttachment,
  });

  /// Converts from the bridge type.
  factory ClayverLastMessage.fromDto(ClayverLastMessageDto dto) =>
      ClayverLastMessage(
        text: dto.text,
        senderType: ClayverSenderType.parse(dto.senderType),
        createdAt: _msOrNull(dto.createdAt),
        hasAttachment: dto.hasAttachment,
      );

  /// Message text, if any.
  final String? text;

  /// Who sent it.
  final ClayverSenderType senderType;

  /// Server time (UTC), when known.
  final DateTime? createdAt;

  /// Whether the message carries an attachment.
  final bool hasAttachment;
}

/// A conversation of the current customer.
@immutable
class ClayverConversation {
  /// Creates a conversation.
  const ClayverConversation({
    required this.id,
    required this.status,
    required this.unreadCount,
    this.createdAt,
    this.updatedAt,
    this.lastMessage,
  });

  /// Converts from the bridge type.
  factory ClayverConversation.fromDto(ClayverConversationDto dto) =>
      ClayverConversation(
        id: dto.id,
        status: ClayverConversationStatus.parse(dto.status),
        createdAt: _msOrNull(dto.createdAt),
        updatedAt: _msOrNull(dto.updatedAt),
        unreadCount: dto.unreadCount,
        lastMessage: dto.lastMessage == null
            ? null
            : ClayverLastMessage.fromDto(dto.lastMessage!),
      );

  /// Conversation id (an RTDB push id).
  final String id;

  /// Open or closed.
  final ClayverConversationStatus status;

  /// Creation time (UTC), when known.
  final DateTime? createdAt;

  /// Time of the last change (UTC), when known.
  final DateTime? updatedAt;

  /// Agent/system messages the customer has not read yet.
  final int unreadCount;

  /// Newest message, if any.
  final ClayverLastMessage? lastMessage;
}

/// The support role of the signed-in user in the configured workspace, read
/// natively from the verified ID token claim `clayver_roles[projectId]`.
///
/// The role only decides what the app offers. The database rules check
/// `agents/{auth.uid}/active` on every agent read and write.
enum ClayverAgentRole {
  /// Workspace admin (can also manage agents from the dashboard).
  admin,

  /// Support agent.
  agent;

  /// Parses the wire value; `null` (and unknown values) mean "not an agent".
  static ClayverAgentRole? parse(String? value) => switch (value) {
    'admin' => admin,
    'agent' => agent,
    _ => null,
  };

  /// Whether this is [admin].
  bool get isAdmin => this == admin;
}

/// A conversation as the support team sees it (`conversations/{id}`), as
/// listed by `Clayver.agentConversations`.
@immutable
class ClayverAgentConversation {
  /// Creates an agent conversation.
  const ClayverAgentConversation({
    required this.id,
    required this.customerId,
    required this.status,
    required this.unreadForAgents,
    this.createdAt,
    this.updatedAt,
    this.lastMessage,
    this.assigneeUid,
  });

  /// Converts from the bridge type.
  factory ClayverAgentConversation.fromDto(ClayverAgentConversationDto dto) =>
      ClayverAgentConversation(
        id: dto.id,
        customerId: dto.customerId,
        status: ClayverConversationStatus.parse(dto.status),
        createdAt: _msOrNull(dto.createdAt),
        updatedAt: _msOrNull(dto.updatedAt),
        lastMessage: dto.lastMessage == null
            ? null
            : ClayverLastMessage.fromDto(dto.lastMessage!),
        unreadForAgents: dto.unreadForAgents,
        assigneeUid: dto.assigneeUid,
      );

  /// Conversation id (an RTDB push id).
  final String id;

  /// The customer who started it.
  final String customerId;

  /// Open or closed.
  final ClayverConversationStatus status;

  /// Creation time (UTC), when known.
  final DateTime? createdAt;

  /// Time of the last change (UTC), when known.
  final DateTime? updatedAt;

  /// Newest message, if any.
  final ClayverLastMessage? lastMessage;

  /// Customer messages the team has not read yet (`unread.agent`).
  final int unreadForAgents;

  /// Firebase uid of the agent the conversation is assigned to, if any.
  final String? assigneeUid;

  /// Latest activity: [updatedAt], else the last message, else [createdAt].
  DateTime? get lastActivityAt =>
      updatedAt ?? lastMessage?.createdAt ?? createdAt;
}

/// A tag of the workspace catalog (`tags/{tagId}`), from `Clayver.tags` and
/// `Clayver.createTag`. Agents only.
@immutable
class ClayverTag {
  /// Creates a tag.
  const ClayverTag({required this.id, required this.name, required this.color});

  /// Converts from the bridge type.
  factory ClayverTag.fromDto(ClayverTagDto dto) =>
      ClayverTag(id: dto.id, name: dto.name, color: dto.color);

  /// The slug of the name at creation time; renaming keeps it.
  final String id;

  /// Display name.
  final String name;

  /// Chip color as `#rrggbb`.
  final String color;

  @override
  bool operator ==(Object other) =>
      other is ClayverTag &&
      other.id == id &&
      other.name == name &&
      other.color == color;

  @override
  int get hashCode => Object.hash(id, name, color);

  @override
  String toString() => 'ClayverTag($id, $name, $color)';
}

/// Why a customer is blocked.
enum ClayverBlockReason {
  /// Spam.
  spam,

  /// Abusive messages.
  abuse,

  /// Too many messages in a short time.
  rateLimit,

  /// Any other reason, including values this version does not know.
  other;

  /// Parses the stored value (`rate_limit` for [rateLimit]); unknown values
  /// map to [other].
  static ClayverBlockReason parse(String? value) => switch (value) {
    'spam' => spam,
    'abuse' => abuse,
    'rate_limit' || 'rateLimit' => rateLimit,
    _ => other,
  };
}

/// An active block on the current customer (`moderation/{customerId}`), from
/// `Clayver.blockStatus`. While it lasts, sends fail with
/// `ClayverErrorCode.permissionDenied` and the native chat replaces the
/// composer with a notice.
@immutable
class ClayverBlockStatus {
  /// Creates a block status.
  const ClayverBlockStatus({required this.reason, this.until});

  /// Converts from the bridge type.
  factory ClayverBlockStatus.fromDto(ClayverBlockStatusDto dto) =>
      ClayverBlockStatus(
        reason: ClayverBlockReason.parse(dto.reason),
        until: _msOrNull(dto.until),
      );

  /// Why the customer is blocked.
  final ClayverBlockReason reason;

  /// When the block ends (UTC); `null` until an agent removes it.
  final DateTime? until;

  @override
  bool operator ==(Object other) =>
      other is ClayverBlockStatus &&
      other.reason == reason &&
      other.until == until;

  @override
  int get hashCode => Object.hash(reason, until);

  @override
  String toString() => 'ClayverBlockStatus(${reason.name}, until: $until)';
}

/// The customer's Firebase Auth account (`users/{customerId}/account`),
/// written by the functions when the customer starts a conversation. The
/// customer id is the Firebase uid.
@immutable
class ClayverCustomerAccount {
  /// Creates an account snapshot.
  const ClayverCustomerAccount({
    required this.anonymous,
    required this.emailVerified,
    this.email,
    this.displayName,
  });

  /// Converts from the bridge type.
  factory ClayverCustomerAccount.fromDto(ClayverCustomerAccountDto dto) =>
      ClayverCustomerAccount(
        anonymous: dto.anonymous,
        email: dto.email,
        emailVerified: dto.emailVerified,
        displayName: dto.displayName,
      );

  /// `true` for an anonymous visitor (no sign-in provider).
  final bool anonymous;

  /// The account's email, when it has one.
  final String? email;

  /// Whether Firebase Auth verified [email].
  final bool emailVerified;

  /// The account's display name, when it has one.
  final String? displayName;
}

/// What the team knows about a customer (`users/{customerId}`), from
/// `Clayver.customerProfile`.
@immutable
class ClayverCustomerProfile {
  /// Creates a profile.
  const ClayverCustomerProfile({
    required this.customerId,
    required this.properties,
    this.account,
    this.lastSeenAt,
  });

  /// Converts from the bridge type. `null` property values are dropped.
  factory ClayverCustomerProfile.fromDto(ClayverCustomerProfileDto dto) =>
      ClayverCustomerProfile(
        customerId: dto.customerId,
        account: dto.account == null
            ? null
            : ClayverCustomerAccount.fromDto(dto.account!),
        properties: Map<String, Object>.unmodifiable(<String, Object>{
          for (final MapEntry<String, Object?> e in dto.properties.entries)
            if (e.value != null) e.key: e.value!,
        }),
        lastSeenAt: _msOrNull(dto.lastSeenAt),
      );

  /// Customer id.
  final String customerId;

  /// The customer's Firebase Auth account, once a conversation recorded it.
  final ClayverCustomerAccount? account;

  /// Properties set with `Clayver.setUserProperties` ([String], [int],
  /// [double] or [bool]).
  final Map<String, Object> properties;

  /// When the customer was last seen (UTC), when known.
  final DateTime? lastSeenAt;

  /// The `Clayver.userProperty.name` property, when it is a non-blank string.
  String? get name => _nonBlank(properties['_name']);

  /// The `Clayver.userProperty.email` property when it is a non-blank string, else the
  /// account's email.
  String? get email => _nonBlank(properties['_email']) ?? _nonBlank(account?.email);

  /// The `Clayver.userProperty.uid` property: the host app's own id for the
  /// user.
  String? get userId => _nonBlank(properties['_uid']);

  /// [name], else the account's name or email, else the first 8 characters of
  /// the customer id. Same rule as the iOS UI.
  String get displayName {
    final String? n =
        name ?? _nonBlank(account?.displayName) ?? _nonBlank(account?.email);
    if (n != null) return n;
    if (customerId.isEmpty) return 'Customer';
    return customerId.length <= 8 ? customerId : customerId.substring(0, 8);
  }

  static String? _nonBlank(Object? value) {
    if (value is! String) return null;
    final String trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }
}

/// An image attached to a message (a JPEG of at most 300 KB for messages
/// sent by current SDKs; older messages may carry other file types).
@immutable
class ClayverAttachment {
  /// Creates an attachment.
  const ClayverAttachment({
    required this.storagePath,
    required this.fileName,
    required this.contentType,
    required this.size,
    this.width,
    this.height,
  });

  /// Converts from the bridge type.
  factory ClayverAttachment.fromDto(ClayverAttachmentDto dto) =>
      ClayverAttachment(
        storagePath: dto.storagePath,
        fileName: dto.fileName,
        contentType: dto.contentType,
        size: dto.size,
        width: dto.width,
        height: dto.height,
      );

  /// Cloud Storage path of the file.
  final String storagePath;

  /// Original file name.
  final String fileName;

  /// MIME type.
  final String contentType;

  /// Size in bytes.
  final int size;

  /// Image width in pixels, for images.
  final int? width;

  /// Image height in pixels, for images.
  final int? height;
}

/// A message in a conversation.
@immutable
class ClayverMessage {
  /// Creates a message.
  const ClayverMessage({
    required this.id,
    required this.conversationId,
    required this.senderId,
    required this.senderType,
    required this.createdAt,
    this.senderName,
    this.text,
    this.attachment,
    this.clientMessageId,
  });

  /// Converts from the bridge type.
  factory ClayverMessage.fromDto(ClayverMessageDto dto) => ClayverMessage(
    id: dto.id,
    conversationId: dto.conversationId,
    senderId: dto.senderId,
    senderType: ClayverSenderType.parse(dto.senderType),
    senderName: dto.senderName,
    text: dto.text,
    attachment: dto.attachment == null
        ? null
        : ClayverAttachment.fromDto(dto.attachment!),
    createdAt: _ms(dto.createdAt),
    clientMessageId: dto.clientMessageId,
  );

  /// Message id (an RTDB push id; chronological order).
  final String id;

  /// The conversation it belongs to.
  final String conversationId;

  /// Customer id or agent uid of the sender.
  final String senderId;

  /// Who sent it.
  final ClayverSenderType senderType;

  /// Agent display name (agents only).
  final String? senderName;

  /// Text, if any.
  final String? text;

  /// Attachment, if any.
  final ClayverAttachment? attachment;

  /// Server time (UTC); an estimate while the write is still pending.
  final DateTime createdAt;

  /// Client-generated id used to reconcile optimistic sends.
  final String? clientMessageId;

  /// Whether the customer wrote this message.
  bool get isFromCustomer => senderType == ClayverSenderType.customer;
}

/// A photo to send with `Clayver.sendMessage`, `Clayver.startConversation` or
/// `Clayver.sendAgentReply`.
///
/// Attachments are images only (JPEG, PNG, GIF, WebP, HEIC); any other content
/// type fails with `ClayverErrorCode.unsupportedAttachmentType`. The native SDK
/// compresses the image to a JPEG of at most [maxBytes] (300 KB) before
/// uploading, so the stored attachment is always `image/jpeg`; if it cannot get
/// under the limit the send fails with `ClayverErrorCode.attachmentTooLarge`.
@immutable
class ClayverAttachmentInput {
  /// Maximum size in bytes of an uploaded attachment, after compression.
  static const int maxBytes = 300 * 1024;

  /// Attaches the file at [filePath] (read by the native SDK).
  const ClayverAttachmentInput.file({
    required String this.filePath,
    required this.fileName,
    required this.contentType,
    this.width,
    this.height,
  }) : bytes = null;

  /// Attaches in-memory [bytes].
  const ClayverAttachmentInput.bytes({
    required Uint8List this.bytes,
    required this.fileName,
    required this.contentType,
    this.width,
    this.height,
  }) : filePath = null;

  /// Local file path.
  final String? filePath;

  /// File contents.
  final Uint8List? bytes;

  /// File name shown in the chat (≤ 200 characters).
  final String fileName;

  /// MIME type of the source image (`image/*`).
  final String contentType;

  /// Image width in pixels, if known (lets the chat size the bubble).
  final int? width;

  /// Image height in pixels, if known.
  final int? height;

  /// Converts to the bridge type.
  ClayverAttachmentInputDto toDto() => ClayverAttachmentInputDto(
    filePath: filePath,
    bytes: bytes,
    fileName: fileName,
    contentType: contentType,
    width: width,
    height: height,
  );
}
