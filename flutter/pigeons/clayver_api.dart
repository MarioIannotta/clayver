// Pigeon definition of the bridge between `package:clayver` and the native
// Clayver SDKs. Regenerate the Dart, Swift and Kotlin outputs with:
//
//   dart run pigeon --input pigeons/clayver_api.dart
//
// Every type here is a transport type (suffixed `Dto`) so it never clashes
// with the native SDK types (`ClayverOptions`, `ClayverMessage`, ...). The
// public Dart models live in `lib/src/models.dart` and convert from/to these.
import 'package:pigeon/pigeon.dart';

@ConfigurePigeon(
  PigeonOptions(
    dartOut: 'lib/src/messages.g.dart',
    dartOptions: DartOptions(),
    swiftOut: 'ios/Classes/Messages.g.swift',
    swiftOptions: SwiftOptions(errorClassName: 'ClayverPigeonError'),
    kotlinOut: 'android/src/main/kotlin/com/clayver/flutter/Messages.g.kt',
    kotlinOptions: KotlinOptions(
      package: 'com.clayver.flutter',
      errorClassName: 'ClayverFlutterError',
    ),
    dartPackageName: 'clayver',
    copyrightHeader: 'pigeons/copyright.txt',
  ),
)
/// Theme colors are 32-bit ARGB integers (`Color.toARGB32()`).
class ClayverThemeDto {
  /// Chat screen title; `null` uses the workspace team name.
  String? title;
  int? accentColor;
  int? customerBubbleColor;
  int? customerTextColor;
  int? agentBubbleColor;
  int? agentTextColor;
  String? fontFamily;
}

class ClayverEmulatorDto {
  ClayverEmulatorDto({
    required this.authPort,
    required this.databasePort,
    required this.functionsPort,
    required this.storagePort,
  });

  /// `null` uses the native default (`localhost` on iOS, `10.0.2.2` on
  /// Android, the host machine as seen from the emulator).
  String? host;
  int authPort;
  int databasePort;
  int functionsPort;
  int storagePort;
}

class ClayverOptionsDto {
  ClayverOptionsDto({
    required this.projectId,
    required this.functionsRegion,
    required this.multipleConversations,
    required this.signInAnonymously,
  });
  String projectId;
  String functionsRegion;
  String? databaseURL;
  String? firebaseAppName;
  ClayverThemeDto? theme;
  ClayverEmulatorDto? emulator;

  /// Whether the native UIs show the conversation list
  /// (`ClayverOptions.multipleConversations`).
  bool multipleConversations;

  /// Whether the native SDK signs in anonymously without a Firebase user
  /// (`ClayverOptions.signInAnonymously`).
  bool signInAnonymously;
}

/// `conversations/{id}/lastMessage`.
class ClayverLastMessageDto {
  ClayverLastMessageDto({
    required this.senderType,
    required this.hasAttachment,
  });
  String? text;

  /// `customer` | `agent` | `system` | `unknown`.
  String senderType;

  /// Milliseconds since epoch, when known.
  int? createdAt;
  bool hasAttachment;
}

class ClayverConversationDto {
  ClayverConversationDto({
    required this.id,
    required this.status,
    required this.unreadCount,
  });
  String id;

  /// `open` | `closed` | `unknown`.
  String status;

  /// Milliseconds since epoch, when known.
  int? createdAt;

  /// Milliseconds since epoch, when known.
  int? updatedAt;
  ClayverLastMessageDto? lastMessage;

  /// Unread messages for the customer (`unread.customer`).
  int unreadCount;
}

class ClayverAttachmentDto {
  ClayverAttachmentDto({
    required this.storagePath,
    required this.fileName,
    required this.contentType,
    required this.size,
  });
  String storagePath;
  String fileName;
  String contentType;
  int size;
  int? width;
  int? height;
}

class ClayverMessageDto {
  ClayverMessageDto({
    required this.id,
    required this.conversationId,
    required this.senderId,
    required this.senderType,
    required this.createdAt,
  });
  String id;
  String conversationId;
  String senderId;

  /// `customer` | `agent` | `system` | `unknown`.
  String senderType;
  String? senderName;
  String? text;
  ClayverAttachmentDto? attachment;

  /// Milliseconds since epoch (server time; an estimate while the write is
  /// pending).
  int createdAt;
  String? clientMessageId;
}

/// An image to attach to an outgoing message: exactly one of [filePath] or
/// [bytes] is set. The native SDK compresses it to a JPEG of at most 300 KB.
class ClayverAttachmentInputDto {
  ClayverAttachmentInputDto({
    required this.fileName,
    required this.contentType,
  });
  String? filePath;
  Uint8List? bytes;
  String fileName;
  String contentType;
  int? width;
  int? height;
}

/// `conversations/{id}` as the support team sees it (agent mode).
class ClayverAgentConversationDto {
  ClayverAgentConversationDto({
    required this.id,
    required this.customerId,
    required this.status,
    required this.unreadForAgents,
  });
  String id;
  String customerId;

  /// `open` | `closed` | `unknown`.
  String status;

  /// Milliseconds since epoch, when known.
  int? createdAt;

  /// Milliseconds since epoch, when known.
  int? updatedAt;
  ClayverLastMessageDto? lastMessage;

  /// Customer messages the team has not read yet (`unread.agent`).
  int unreadForAgents;

  /// Firebase uid of the assigned agent, if any.
  String? assigneeUid;
}

/// `tags/{tagId}` (agent mode).
class ClayverTagDto {
  ClayverTagDto({required this.id, required this.name, required this.color});
  String id;
  String name;

  /// `#rrggbb`.
  String color;
}

/// An active block on the customer (`moderation/{customerId}`).
class ClayverBlockStatusDto {
  ClayverBlockStatusDto({required this.reason});

  /// Stored value: `spam` | `abuse` | `rate_limit` | `other` (unknown values
  /// are sent as `other`).
  String reason;

  /// Milliseconds since epoch; `null` until an agent removes the block.
  int? until;
}

/// One `blockStatus` event: [status] is `null` while the customer may write.
class ClayverBlockStateDto {
  ClayverBlockStatusDto? status;
}

/// `users/{customerId}` (agent mode).
/// `users/{customerId}/account`: the customer's Firebase Auth account.
class ClayverCustomerAccountDto {
  ClayverCustomerAccountDto({
    required this.anonymous,
    required this.emailVerified,
  });
  bool anonymous;
  String? email;
  bool emailVerified;
  String? displayName;
}

class ClayverCustomerProfileDto {
  ClayverCustomerProfileDto({
    required this.customerId,
    required this.properties,
  });
  String customerId;
  ClayverCustomerAccountDto? account;

  /// Values are `String`, `int`, `double` or `bool`.
  Map<String, Object?> properties;

  /// Milliseconds since epoch, when known.
  int? lastSeenAt;
}

/// Request/response calls. Every method is async on the native side and fails
/// with a `PlatformException` whose `code` is one of the stable Clayver error
/// codes (`notConfigured`, `notAuthenticated`, `permissionDenied`,
/// `invalidArgument`, `network`, `attachmentTooLarge`,
/// `unsupportedAttachmentType`, `cancelled`, `internal`).
@HostApi()
abstract class ClayverHostApi {
  @async
  void configure(ClayverOptionsDto options);

  @async
  void logout();

  /// Values are `String`, `int`, `double` or `bool` (validated in Dart).
  @async
  void setUserProperties(Map<String, Object> properties);

  /// FCM registration token on both platforms.
  @async
  void setPushToken(String token);

  @async
  void clearPushToken();

  @async
  int getUnreadMessagesCount();

  @async
  void openChat(String? conversationId);

  @async
  bool handleNotification(Map<String, String> data);

  @async
  List<ClayverMessageDto> loadOlderMessages(
    String conversationId,
    String beforeMessageId,
    int limit,
  );

  @async
  ClayverMessageDto sendMessage(
    String? text,
    String? conversationId,
    ClayverAttachmentInputDto? attachment,
  );

  @async
  void markConversationRead(String conversationId);

  /// Opens the native conversation list.
  @async
  void openConversations();

  /// Opens a new, empty native chat.
  @async
  void openNewConversation();

  /// Sends the first message of a new conversation.
  @async
  ClayverMessageDto startConversation(
    String? text,
    ClayverAttachmentInputDto? attachment,
  );

  /// Calls `clayverDeleteMyData`, then logs out.
  @async
  void deleteCustomerData();

  // Agent mode.

  /// `admin` | `agent`, or `null` for customers.
  @async
  String? agentRole(bool forceRefresh);

  @async
  bool isAgent();

  @async
  void openAgentInbox(String? conversationId);

  @async
  ClayverMessageDto sendAgentReply(
    String conversationId,
    String? text,
    ClayverAttachmentInputDto? attachment,
  );

  /// [status] is `open` or `closed`.
  @async
  void setConversationStatus(String conversationId, String status);

  @async
  void assignConversation(String conversationId, bool toMe);

  @async
  void markConversationReadAsAgent(String conversationId);

  /// [color] is `#rrggbb`, or `null` for the palette color of the slug.
  @async
  ClayverTagDto createTag(String name, String? color);

  @async
  void addTag(String conversationId, String tagId);

  @async
  void removeTag(String conversationId, String tagId);

  /// Registers the `messages` event channel under [instanceName] for
  /// [conversationId]. The Dart side then listens to
  /// `ClayverEventApi.messages(instanceName: instanceName)`.
  /// This lets any number of message streams run at the same time.
  void registerMessagesChannel(String instanceName, String conversationId);

  /// Removes the channel registered by [registerMessagesChannel] and stops its
  /// native listener if it is still running.
  void unregisterMessagesChannel(String instanceName);

  /// Registers the `agentConversations` event channel under [instanceName]
  /// for conversations with [status] (`open` | `closed`), at most [limit],
  /// only those tagged [tagId] when it is set.
  void registerAgentConversationsChannel(
    String instanceName,
    String status,
    int limit,
    String? tagId,
  );

  void unregisterAgentConversationsChannel(String instanceName);

  /// Registers the `customerProfile` event channel under [instanceName].
  void registerCustomerProfileChannel(String instanceName, String customerId);

  void unregisterCustomerProfileChannel(String instanceName);

  /// Registers the `conversationTags` event channel under [instanceName].
  void registerConversationTagsChannel(
    String instanceName,
    String conversationId,
  );

  void unregisterConversationTagsChannel(String instanceName);
}

/// Live streams. Each native stream handler starts the SDK stream/flow in
/// `onListen` and cancels it in `onCancel`. A failed stream sends one error
/// (with a Clayver error code) and then ends.
@EventChannelApi()
abstract class ClayverEventApi {
  int unreadCount();
  List<ClayverConversationDto> conversations();
  List<ClayverMessageDto> messages();
  List<ClayverAgentConversationDto> agentConversations();
  ClayverCustomerProfileDto customerProfile();
  ClayverBlockStateDto blockStatus();
  List<ClayverTagDto> tags();

  /// Tag ids of one conversation (keyed by instance name).
  List<String> conversationTags();
}
