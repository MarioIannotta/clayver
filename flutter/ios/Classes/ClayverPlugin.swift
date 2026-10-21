// Copyright (c) Clayver contributors. Licensed under the Apache License 2.0.
//
// Flutter bridge for the Clayver iOS SDK. Every call is forwarded to the
// `Clayver` facade of `ClayverSDK`; this file only converts Pigeon types and
// errors. Messaging, push registration, agent mode and the chat/inbox UIs live
// in the native SDK.

import ClayverSDK
import FirebaseCore
import Flutter
import SwiftUI
import UIKit

public final class ClayverPlugin: NSObject, FlutterPlugin {
  private let messenger: FlutterBinaryMessenger
  private let unreadCountHandler = UnreadCountBridge()
  private let conversationsHandler = ConversationsBridge()
  private let blockStatusHandler = BlockStatusBridge()
  private let tagsHandler = TagsBridge()
  /// Message streams by Pigeon instance name (one per Dart subscription).
  private var messageHandlers: [String: MessagesBridge] = [:]
  /// Agent inbox streams by Pigeon instance name.
  private var agentConversationHandlers: [String: AgentConversationsBridge] = [:]
  /// Customer profile streams by Pigeon instance name.
  private var profileHandlers: [String: CustomerProfileBridge] = [:]
  /// Conversation tag streams by Pigeon instance name.
  private var conversationTagHandlers: [String: ConversationTagsBridge] = [:]

  init(messenger: FlutterBinaryMessenger) {
    self.messenger = messenger
  }

  public static func register(with registrar: FlutterPluginRegistrar) {
    let messenger = registrar.messenger()
    let plugin = ClayverPlugin(messenger: messenger)
    ClayverHostApiSetup.setUp(binaryMessenger: messenger, api: plugin)
    UnreadCountStreamHandler.register(with: messenger, streamHandler: plugin.unreadCountHandler)
    ConversationsStreamHandler.register(with: messenger, streamHandler: plugin.conversationsHandler)
    BlockStatusStreamHandler.register(with: messenger, streamHandler: plugin.blockStatusHandler)
    TagsStreamHandler.register(with: messenger, streamHandler: plugin.tagsHandler)
    registrar.publish(plugin)
  }

  public func detachFromEngine(for registrar: FlutterPluginRegistrar) {
    ClayverHostApiSetup.setUp(binaryMessenger: messenger, api: nil)
    unreadCountHandler.cancel()
    conversationsHandler.cancel()
    blockStatusHandler.cancel()
    tagsHandler.cancel()
    for name in Array(messageHandlers.keys) {
      try? unregisterMessagesChannel(instanceName: name)
    }
    for name in Array(agentConversationHandlers.keys) {
      try? unregisterAgentConversationsChannel(instanceName: name)
    }
    for name in Array(profileHandlers.keys) {
      try? unregisterCustomerProfileChannel(instanceName: name)
    }
    for name in Array(conversationTagHandlers.keys) {
      try? unregisterConversationTagsChannel(instanceName: name)
    }
  }
}

// MARK: - Host API

extension ClayverPlugin: ClayverHostApi {
  func configure(options: ClayverOptionsDto) async throws {
    try await bridge {
      try await Clayver.configure(try Self.makeOptions(options))
    }
  }

  func logout() async throws {
    try await bridge { try await Clayver.logout() }
  }

  func deleteCustomerData() async throws {
    try await bridge { try await Clayver.deleteCustomerData() }
  }

  func setUserProperties(properties: [String: Any]) async throws {
    try await bridge {
      var values: [String: ClayverValue] = [:]
      for (key, value) in properties {
        values[key] = try Self.clayverValue(key: key, value)
      }
      try await Clayver.setUserProperties(values)
    }
  }

  /// Flutter apps get the FCM registration token from `firebase_messaging`, so
  /// this is `Clayver.setFCMToken`, not the APNs-token variant.
  func setPushToken(token: String) async throws {
    try await bridge { try await Clayver.setFCMToken(token) }
  }

  func clearPushToken() async throws {
    try await bridge { try await Clayver.clearPushToken() }
  }

  func getUnreadMessagesCount() async throws -> Int64 {
    try await bridge { Int64(try await Clayver.getUnreadMessagesCount()) }
  }

  func openChat(conversationId: String?) async throws {
    // Presents modally over the top-most view controller (the FlutterViewController
    // or whatever it is presenting).
    await Clayver.openChat(conversationId: conversationId, from: nil)
  }

  func openConversations() async throws {
    await Clayver.openConversations(from: nil)
  }

  func openNewConversation() async throws {
    await Clayver.openNewConversation(from: nil)
  }

  func handleNotification(data: [String: String]) async throws -> Bool {
    let userInfo: [AnyHashable: Any] = data.reduce(into: [:]) { $0[$1.key] = $1.value }
    return await MainActor.run { Clayver.handleNotification(userInfo: userInfo) }
  }

  func loadOlderMessages(conversationId: String, beforeMessageId: String, limit: Int64) async throws -> [ClayverMessageDto] {
    try await bridge {
      try await Clayver.loadOlderMessages(
        conversationId: conversationId, before: beforeMessageId, limit: Int(limit)
      ).map(Self.messageDto)
    }
  }

  func sendMessage(text: String?, conversationId: String?, attachment: ClayverAttachmentInputDto?) async throws -> ClayverMessageDto {
    try await bridge {
      let input = try attachment.map(Self.attachmentInput)
      let message = try await Clayver.sendMessage(text: text, conversationId: conversationId, attachment: input)
      return Self.messageDto(message)
    }
  }

  func startConversation(text: String?, attachment: ClayverAttachmentInputDto?) async throws -> ClayverMessageDto {
    try await bridge {
      let input = try attachment.map(Self.attachmentInput)
      let message = try await Clayver.startConversation(text: text, attachment: input)
      return Self.messageDto(message)
    }
  }

  func markConversationRead(conversationId: String) async throws {
    try await bridge { try await Clayver.markConversationRead(conversationId) }
  }

  // MARK: Agent mode

  func agentRole(forceRefresh: Bool) async throws -> String? {
    try await bridge { try await Clayver.agentRole(forceRefresh: forceRefresh)?.rawValue }
  }

  func isAgent() async throws -> Bool {
    try await bridge { try await Clayver.isAgent() }
  }

  func sendAgentReply(conversationId: String, text: String?, attachment: ClayverAttachmentInputDto?) async throws -> ClayverMessageDto {
    try await bridge {
      let input = try attachment.map(Self.attachmentInput)
      let message = try await Clayver.sendAgentReply(conversationId: conversationId, text: text, attachment: input)
      return Self.messageDto(message)
    }
  }

  func setConversationStatus(conversationId: String, status: String) async throws {
    try await bridge {
      try await Clayver.setConversationStatus(conversationId, try Self.conversationStatus(status))
    }
  }

  func assignConversation(conversationId: String, toMe: Bool) async throws {
    try await bridge { try await Clayver.assignConversation(conversationId, toMe: toMe) }
  }

  func markConversationReadAsAgent(conversationId: String) async throws {
    try await bridge { try await Clayver.markConversationReadAsAgent(conversationId) }
  }

  func createTag(name: String, color: String?) async throws -> ClayverTagDto {
    try await bridge { Self.tagDto(try await Clayver.createTag(name: name, color: color)) }
  }

  func addTag(conversationId: String, tagId: String) async throws {
    try await bridge { try await Clayver.addTag(tagId, to: conversationId) }
  }

  func removeTag(conversationId: String, tagId: String) async throws {
    try await bridge { try await Clayver.removeTag(tagId, from: conversationId) }
  }

  func registerAgentConversationsChannel(instanceName: String, status: String, limit: Int64, tagId: String?) throws {
    let nativeStatus = try Self.conversationStatus(status)
    guard limit > 0, limit <= Int64(Int32.max) else {
      throw invalidArgument("limit must be positive, got \(limit).")
    }
    try? unregisterAgentConversationsChannel(instanceName: instanceName)
    let handler = AgentConversationsBridge(status: nativeStatus, limit: Int(limit), tagId: tagId)
    agentConversationHandlers[instanceName] = handler
    AgentConversationsStreamHandler.register(with: messenger, instanceName: instanceName, streamHandler: handler)
  }

  func unregisterAgentConversationsChannel(instanceName: String) throws {
    agentConversationHandlers.removeValue(forKey: instanceName)?.cancel()
    messenger.setMessageHandlerOnChannel(
      "dev.flutter.pigeon.clayver.ClayverEventApi.agentConversations.\(instanceName)",
      binaryMessageHandler: nil
    )
  }

  func registerCustomerProfileChannel(instanceName: String, customerId: String) throws {
    try? unregisterCustomerProfileChannel(instanceName: instanceName)
    let handler = CustomerProfileBridge(customerId: customerId)
    profileHandlers[instanceName] = handler
    CustomerProfileStreamHandler.register(with: messenger, instanceName: instanceName, streamHandler: handler)
  }

  func unregisterCustomerProfileChannel(instanceName: String) throws {
    profileHandlers.removeValue(forKey: instanceName)?.cancel()
    messenger.setMessageHandlerOnChannel(
      "dev.flutter.pigeon.clayver.ClayverEventApi.customerProfile.\(instanceName)",
      binaryMessageHandler: nil
    )
  }

  func registerConversationTagsChannel(instanceName: String, conversationId: String) throws {
    try? unregisterConversationTagsChannel(instanceName: instanceName)
    let handler = ConversationTagsBridge(conversationId: conversationId)
    conversationTagHandlers[instanceName] = handler
    ConversationTagsStreamHandler.register(with: messenger, instanceName: instanceName, streamHandler: handler)
  }

  func unregisterConversationTagsChannel(instanceName: String) throws {
    conversationTagHandlers.removeValue(forKey: instanceName)?.cancel()
    messenger.setMessageHandlerOnChannel(
      "dev.flutter.pigeon.clayver.ClayverEventApi.conversationTags.\(instanceName)",
      binaryMessageHandler: nil
    )
  }

  // MARK: Message streams

  func registerMessagesChannel(instanceName: String, conversationId: String) throws {
    try? unregisterMessagesChannel(instanceName: instanceName)
    let handler = MessagesBridge(conversationId: conversationId)
    messageHandlers[instanceName] = handler
    MessagesStreamHandler.register(with: messenger, instanceName: instanceName, streamHandler: handler)
  }

  func unregisterMessagesChannel(instanceName: String) throws {
    messageHandlers.removeValue(forKey: instanceName)?.cancel()
    messenger.setMessageHandlerOnChannel(
      "dev.flutter.pigeon.clayver.ClayverEventApi.messages.\(instanceName)",
      binaryMessageHandler: nil
    )
  }
}

// MARK: - Errors

/// Maps any error to the stable Clayver code (`ClayverError.Code.rawValue`).
/// Task cancellation becomes `cancelled`.
func clayverPigeonError(_ error: Error) -> ClayverPigeonError {
  if let error = error as? ClayverPigeonError { return error }
  if error is CancellationError {
    return ClayverPigeonError(code: "cancelled", message: "The operation was cancelled.", details: nil)
  }
  let clayverError = ClayverError.from(error)
  return ClayverPigeonError(
    code: clayverError.code.rawValue,
    message: clayverError.localizedDescription,
    details: nil
  )
}

private func bridge<T>(_ body: () async throws -> T) async throws -> T {
  do {
    return try await body()
  } catch {
    throw clayverPigeonError(error)
  }
}

private func invalidArgument(_ message: String) -> ClayverPigeonError {
  ClayverPigeonError(code: ClayverError.Code.invalidArgument.rawValue, message: message, details: nil)
}

// MARK: - Conversions

extension ClayverPlugin {
  static func makeOptions(_ dto: ClayverOptionsDto) throws -> ClayverOptions {
    var app: FirebaseApp?
    if let name = dto.firebaseAppName {
      guard let named = FirebaseApp.app(name: name) else {
        throw invalidArgument("No Firebase app named \"\(name)\". Initialize it with Firebase.initializeApp(name:) first.")
      }
      app = named
    }
    return ClayverOptions(
      projectId: dto.projectId,
      functionsRegion: dto.functionsRegion,
      databaseURL: dto.databaseURL,
      firebaseApp: app,
      theme: dto.theme.map(makeTheme) ?? .default,
      useEmulator: dto.emulator.map {
        ClayverOptions.Emulator(
          host: $0.host ?? ClayverOptions.Emulator().host,
          authPort: Int($0.authPort),
          databasePort: Int($0.databasePort),
          functionsPort: Int($0.functionsPort),
          storagePort: Int($0.storagePort)
        )
      },
      multipleConversations: dto.multipleConversations,
      signInAnonymously: dto.signInAnonymously
    )
  }

  static func makeTheme(_ dto: ClayverThemeDto) -> ClayverTheme {
    var theme = ClayverTheme(
      title: dto.title,
      accentColor: dto.accentColor.map(color) ?? .accentColor,
      customerBubbleColor: dto.customerBubbleColor.map(color)
    )
    if let value = dto.customerTextColor { theme.customerTextColor = color(value) }
    if let value = dto.agentBubbleColor { theme.agentBubbleColor = color(value) }
    if let value = dto.agentTextColor { theme.agentTextColor = color(value) }
    if let family = dto.fontFamily {
      // Keep Dynamic Type working with the custom typeface.
      theme.bodyFont = .custom(family, size: 17, relativeTo: .body)
      theme.captionFont = .custom(family, size: 11, relativeTo: .caption2)
      theme.headlineFont = .custom(family, size: 17, relativeTo: .headline)
    }
    return theme
  }

  /// ARGB integer (`Color.toARGB32()` in Dart) to SwiftUI color.
  static func color(_ argb: Int64) -> Color {
    let value = UInt32(truncatingIfNeeded: argb)
    return Color(
      .sRGB,
      red: Double((value >> 16) & 0xFF) / 255,
      green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255,
      opacity: Double((value >> 24) & 0xFF) / 255
    )
  }

  /// Standard codec values arrive as `String` or `NSNumber`; booleans are
  /// `CFBoolean`-backed numbers.
  static func clayverValue(key: String, _ value: Any) throws -> ClayverValue {
    if let string = value as? String { return .string(string) }
    if let number = value as? NSNumber {
      if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
      if CFNumberIsFloatType(number) { return .double(number.doubleValue) }
      return .int(number.intValue)
    }
    throw invalidArgument("Property \"\(key)\" must be a String, int, double or bool.")
  }

  static func attachmentInput(_ dto: ClayverAttachmentInputDto) throws -> ClayverAttachmentInput {
    let data: Data
    if let bytes = dto.bytes {
      data = bytes.data
    } else if let path = dto.filePath {
      do {
        data = try Data(contentsOf: URL(fileURLWithPath: path), options: .mappedIfSafe)
      } catch {
        throw invalidArgument("Cannot read attachment file at \(path): \(error.localizedDescription)")
      }
    } else {
      throw invalidArgument("An attachment needs either a file path or bytes.")
    }
    return ClayverAttachmentInput(
      data: data,
      fileName: dto.fileName,
      contentType: dto.contentType,
      width: dto.width.map(Int.init),
      height: dto.height.map(Int.init)
    )
  }

  static func millis(_ date: Date) -> Int64 {
    Int64((date.timeIntervalSince1970 * 1000).rounded())
  }

  static func messageDto(_ message: ClayverMessage) -> ClayverMessageDto {
    ClayverMessageDto(
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderType: message.senderType.rawValue,
      senderName: message.senderName,
      text: message.text,
      attachment: message.attachment.map {
        ClayverAttachmentDto(
          storagePath: $0.storagePath,
          fileName: $0.fileName,
          contentType: $0.contentType,
          size: Int64($0.size),
          width: $0.width.map(Int64.init),
          height: $0.height.map(Int64.init)
        )
      },
      createdAt: millis(message.createdAt),
      clientMessageId: message.clientMessageId
    )
  }

  static func lastMessageDto(_ lastMessage: ClayverConversation.LastMessage) -> ClayverLastMessageDto {
    ClayverLastMessageDto(
      text: lastMessage.text,
      senderType: lastMessage.senderType.rawValue,
      createdAt: lastMessage.createdAt.map(millis),
      hasAttachment: lastMessage.hasAttachment
    )
  }

  static func conversationDto(_ conversation: ClayverConversation) -> ClayverConversationDto {
    ClayverConversationDto(
      id: conversation.id,
      status: conversation.status.rawValue,
      createdAt: conversation.createdAt.map(millis),
      updatedAt: conversation.updatedAt.map(millis),
      lastMessage: conversation.lastMessage.map(lastMessageDto),
      unreadCount: Int64(conversation.unreadCount)
    )
  }

  static func agentConversationDto(_ conversation: ClayverAgentConversation) -> ClayverAgentConversationDto {
    ClayverAgentConversationDto(
      id: conversation.id,
      customerId: conversation.customerId,
      status: conversation.status.rawValue,
      createdAt: conversation.createdAt.map(millis),
      updatedAt: conversation.updatedAt.map(millis),
      lastMessage: conversation.lastMessage.map(lastMessageDto),
      unreadForAgents: Int64(conversation.unreadForAgents),
      assigneeUid: conversation.assigneeUid
    )
  }

  static func customerProfileDto(_ profile: ClayverCustomerProfile) -> ClayverCustomerProfileDto {
    var properties: [String: Any?] = [:]
    for (key, value) in profile.properties {
      switch value {
      case .string(let string): properties[key] = string
      case .int(let int): properties[key] = Int64(int)
      case .double(let double): properties[key] = double
      case .bool(let bool): properties[key] = bool
      }
    }
    return ClayverCustomerProfileDto(
      customerId: profile.customerId,
      account: profile.account.map {
        ClayverCustomerAccountDto(
          anonymous: $0.anonymous,
          email: $0.email,
          emailVerified: $0.emailVerified,
          displayName: $0.displayName
        )
      },
      properties: properties,
      lastSeenAt: profile.lastSeenAt.map(millis)
    )
  }

  static func tagDto(_ tag: ClayverTag) -> ClayverTagDto {
    ClayverTagDto(id: tag.id, name: tag.name, color: tag.color)
  }

  /// The stored reason (`rate_limit`, ...); Dart parses it.
  static func blockStateDto(_ status: ClayverBlockStatus?) -> ClayverBlockStateDto {
    ClayverBlockStateDto(
      status: status.map {
        ClayverBlockStatusDto(reason: $0.reason.rawValue, until: $0.until.map(millis))
      }
    )
  }

  /// `open` | `closed`; `unknown` and anything else is `invalidArgument`.
  static func conversationStatus(_ wire: String) throws -> ClayverConversationStatus {
    switch wire {
    case ClayverConversationStatus.open.rawValue: return .open
    case ClayverConversationStatus.closed.rawValue: return .closed
    default: throw invalidArgument("Conversation status must be open or closed, got \"\(wire)\".")
    }
  }
}

// MARK: - Streams

/// Runs one `AsyncThrowingStream` per Dart listener and forwards it to a Pigeon
/// event sink on the main actor. `cancel()` cancels the Task, which ends the
/// iteration and makes the SDK remove its Firebase listener (`onTermination`).
/// A failure is sent as one error with a Clayver code, then end-of-stream.
final class StreamTask {
  private var task: Task<Void, Never>?

  func start<Element, Output>(
    _ makeStream: @escaping () -> AsyncThrowingStream<Element, Error>,
    map: @escaping (Element) -> Output,
    sink: PigeonEventSink<Output>
  ) {
    task?.cancel()
    task = Task { @MainActor in
      do {
        for try await element in makeStream() {
          if Task.isCancelled { return }
          sink.success(map(element))
        }
        if !Task.isCancelled { sink.endOfStream() }
      } catch {
        if Task.isCancelled { return }
        let pigeonError = clayverPigeonError(error)
        sink.error(code: pigeonError.code, message: pigeonError.message, details: nil)
        sink.endOfStream()
      }
    }
  }

  func cancel() {
    task?.cancel()
    task = nil
  }
}

final class UnreadCountBridge: UnreadCountStreamHandler {
  private let stream = StreamTask()

  override func onListen(withArguments arguments: Any?, sink: PigeonEventSink<Int64>) {
    stream.start({ Clayver.unreadCountUpdates() }, map: { Int64($0) }, sink: sink)
  }

  override func onCancel(withArguments arguments: Any?) { stream.cancel() }

  func cancel() { stream.cancel() }
}

final class ConversationsBridge: ConversationsStreamHandler {
  private let stream = StreamTask()

  override func onListen(withArguments arguments: Any?, sink: PigeonEventSink<[ClayverConversationDto]>) {
    stream.start({ Clayver.conversations() }, map: { $0.map(ClayverPlugin.conversationDto) }, sink: sink)
  }

  override func onCancel(withArguments arguments: Any?) { stream.cancel() }

  func cancel() { stream.cancel() }
}

final class MessagesBridge: MessagesStreamHandler {
  private let conversationId: String
  private let stream = StreamTask()

  init(conversationId: String) {
    self.conversationId = conversationId
  }

  override func onListen(withArguments arguments: Any?, sink: PigeonEventSink<[ClayverMessageDto]>) {
    let conversationId = self.conversationId
    stream.start(
      { Clayver.messages(conversationId: conversationId) },
      map: { $0.map(ClayverPlugin.messageDto) },
      sink: sink
    )
  }

  override func onCancel(withArguments arguments: Any?) { stream.cancel() }

  func cancel() { stream.cancel() }
}

final class AgentConversationsBridge: AgentConversationsStreamHandler {
  private let status: ClayverConversationStatus
  private let limit: Int
  private let tagId: String?
  private let stream = StreamTask()

  init(status: ClayverConversationStatus, limit: Int, tagId: String?) {
    self.status = status
    self.limit = limit
    self.tagId = tagId
  }

  override func onListen(withArguments arguments: Any?, sink: PigeonEventSink<[ClayverAgentConversationDto]>) {
    let status = self.status
    let limit = self.limit
    let tagId = self.tagId
    stream.start(
      { Clayver.agentConversations(status: status, limit: limit, tagId: tagId) },
      map: { $0.map(ClayverPlugin.agentConversationDto) },
      sink: sink
    )
  }

  override func onCancel(withArguments arguments: Any?) { stream.cancel() }

  func cancel() { stream.cancel() }
}

final class CustomerProfileBridge: CustomerProfileStreamHandler {
  private let customerId: String
  private let stream = StreamTask()

  init(customerId: String) {
    self.customerId = customerId
  }

  override func onListen(withArguments arguments: Any?, sink: PigeonEventSink<ClayverCustomerProfileDto>) {
    let customerId = self.customerId
    stream.start(
      { Clayver.customerProfile(customerId: customerId) },
      map: ClayverPlugin.customerProfileDto,
      sink: sink
    )
  }

  override func onCancel(withArguments arguments: Any?) { stream.cancel() }

  func cancel() { stream.cancel() }
}

final class BlockStatusBridge: BlockStatusStreamHandler {
  private let stream = StreamTask()

  override func onListen(withArguments arguments: Any?, sink: PigeonEventSink<ClayverBlockStateDto>) {
    stream.start({ Clayver.blockStatus() }, map: ClayverPlugin.blockStateDto, sink: sink)
  }

  override func onCancel(withArguments arguments: Any?) { stream.cancel() }

  func cancel() { stream.cancel() }
}

final class TagsBridge: TagsStreamHandler {
  private let stream = StreamTask()

  override func onListen(withArguments arguments: Any?, sink: PigeonEventSink<[ClayverTagDto]>) {
    stream.start({ Clayver.tags() }, map: { $0.map(ClayverPlugin.tagDto) }, sink: sink)
  }

  override func onCancel(withArguments arguments: Any?) { stream.cancel() }

  func cancel() { stream.cancel() }
}

final class ConversationTagsBridge: ConversationTagsStreamHandler {
  private let conversationId: String
  private let stream = StreamTask()

  init(conversationId: String) {
    self.conversationId = conversationId
  }

  override func onListen(withArguments arguments: Any?, sink: PigeonEventSink<[String]>) {
    let conversationId = self.conversationId
    stream.start(
      { Clayver.conversationTags(conversationId: conversationId) },
      map: { $0 },
      sink: sink
    )
  }

  override func onCancel(withArguments arguments: Any?) { stream.cancel() }

  func cancel() { stream.cancel() }
}
