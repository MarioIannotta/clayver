import 'package:clayver/clayver.dart';
import 'package:clayver/src/messages.g.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Records every call and answers with canned results.
class FakeHostApi implements ClayverHostApi {
  final List<(String, List<Object?>)> calls = [];

  /// Calls as `[method, ...args]`, for deep equality checks.
  List<List<Object?>> get flat => [
    for (final (String m, List<Object?> a) in calls) [m, ...a],
  ];
  Object? error;
  int unreadCount = 0;
  bool handled = false;
  List<ClayverMessageDto> olderMessages = [];
  ClayverMessageDto? sent;
  String? role;
  bool agent = false;
  ClayverTagDto? createdTag;

  Future<T> _record<T>(String method, List<Object?> args, T result) async {
    calls.add((method, args));
    final Object? e = error;
    if (e != null) throw e;
    return result;
  }

  @override
  Future<void> configure(ClayverOptionsDto options) =>
      _record('configure', [options], null);
  @override
  Future<void> logout() => _record('logout', [], null);
  @override
  Future<void> setUserProperties(Map<String, Object> properties) =>
      _record('setUserProperties', [properties], null);
  @override
  Future<void> setPushToken(String token) =>
      _record('setPushToken', [token], null);
  @override
  Future<void> clearPushToken() => _record('clearPushToken', [], null);
  @override
  Future<int> getUnreadMessagesCount() =>
      _record('getUnreadMessagesCount', [], unreadCount);
  @override
  Future<void> openChat(String? conversationId) =>
      _record('openChat', [conversationId], null);
  @override
  Future<bool> handleNotification(Map<String, String> data) =>
      _record('handleNotification', [data], handled);
  @override
  Future<List<ClayverMessageDto>> loadOlderMessages(
    String conversationId,
    String beforeMessageId,
    int limit,
  ) => _record('loadOlderMessages', [
    conversationId,
    beforeMessageId,
    limit,
  ], olderMessages);
  @override
  Future<ClayverMessageDto> sendMessage(
    String? text,
    String? conversationId,
    ClayverAttachmentInputDto? attachment,
  ) => _record('sendMessage', [text, conversationId, attachment], sent!);
  @override
  Future<void> markConversationRead(String conversationId) =>
      _record('markConversationRead', [conversationId], null);
  @override
  Future<void> openConversations() => _record('openConversations', [], null);
  @override
  Future<void> openNewConversation() =>
      _record('openNewConversation', [], null);
  @override
  Future<ClayverMessageDto> startConversation(
    String? text,
    ClayverAttachmentInputDto? attachment,
  ) => _record('startConversation', [text, attachment], sent!);
  @override
  Future<void> deleteCustomerData() => _record('deleteCustomerData', [], null);
  @override
  Future<ClayverTagDto> createTag(String name, String? color) => _record(
    'createTag',
    [name, color],
    createdTag ?? ClayverTagDto(id: 'x', name: 'x', color: '#000000'),
  );
  @override
  Future<void> addTag(String conversationId, String tagId) =>
      _record('addTag', [conversationId, tagId], null);
  @override
  Future<void> removeTag(String conversationId, String tagId) =>
      _record('removeTag', [conversationId, tagId], null);
  @override
  Future<void> registerConversationTagsChannel(
    String instanceName,
    String conversationId,
  ) => _record('registerConversationTagsChannel', [
    instanceName,
    conversationId,
  ], null);
  @override
  Future<void> unregisterConversationTagsChannel(String instanceName) =>
      _record('unregisterConversationTagsChannel', [instanceName], null);
  @override
  Future<void> registerMessagesChannel(
    String instanceName,
    String conversationId,
  ) => _record('registerMessagesChannel', [instanceName, conversationId], null);
  @override
  Future<void> unregisterMessagesChannel(String instanceName) =>
      _record('unregisterMessagesChannel', [instanceName], null);

  @override
  Future<String?> agentRole(bool forceRefresh) =>
      _record('agentRole', [forceRefresh], role);
  @override
  Future<bool> isAgent() => _record('isAgent', [], agent);
  @override
  Future<ClayverMessageDto> sendAgentReply(
    String conversationId,
    String? text,
    ClayverAttachmentInputDto? attachment,
  ) => _record('sendAgentReply', [conversationId, text, attachment], sent!);
  @override
  Future<void> setConversationStatus(String conversationId, String status) =>
      _record('setConversationStatus', [conversationId, status], null);
  @override
  Future<void> assignConversation(String conversationId, bool toMe) =>
      _record('assignConversation', [conversationId, toMe], null);
  @override
  Future<void> markConversationReadAsAgent(String conversationId) =>
      _record('markConversationReadAsAgent', [conversationId], null);
  @override
  Future<void> registerAgentConversationsChannel(
    String instanceName,
    String status,
    int limit,
    String? tagId,
  ) => _record('registerAgentConversationsChannel', [
    instanceName,
    status,
    limit,
    tagId,
  ], null);
  @override
  Future<void> unregisterAgentConversationsChannel(String instanceName) =>
      _record('unregisterAgentConversationsChannel', [instanceName], null);
  @override
  Future<void> registerCustomerProfileChannel(
    String instanceName,
    String customerId,
  ) => _record('registerCustomerProfileChannel', [
    instanceName,
    customerId,
  ], null);
  @override
  Future<void> unregisterCustomerProfileChannel(String instanceName) =>
      _record('unregisterCustomerProfileChannel', [instanceName], null);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

ClayverMessageDto messageDto(String id) => ClayverMessageDto(
  id: id,
  conversationId: 'c1',
  senderId: 'v_abc',
  senderType: 'customer',
  text: 'hi $id',
  createdAt: 1700000000000,
  clientMessageId: 'local-$id',

  attachment: ClayverAttachmentDto(
    storagePath: 'clayver/projects/default/customers/v_abc/x.png',
    fileName: 'x.png',
    contentType: 'image/png',
    size: 42,
    width: 10,
    height: 20,
  ),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late FakeHostApi api;

  setUp(() {
    Clayver.resetForTesting();
    api = FakeHostApi();
    Clayver.hostApi = api;
  });

  group('argument passing', () {
    test('configure sends defaults when no options are given', () async {
      await Clayver.configure();
      final ClayverOptionsDto dto =
          api.calls.single.$2.single! as ClayverOptionsDto;
      expect(dto.projectId, 'default');
      expect(dto.functionsRegion, 'us-central1');
      expect(dto.databaseURL, isNull);
      expect(dto.theme, isNull);
      expect(dto.emulator, isNull);
      expect(dto.multipleConversations, isTrue);
      expect(dto.signInAnonymously, isTrue);
    });

    test('configure forwards signInAnonymously', () async {
      await Clayver.configure(
        options: const ClayverOptions(signInAnonymously: false),
      );
      final ClayverOptionsDto dto =
          api.calls.single.$2.single! as ClayverOptionsDto;
      expect(dto.signInAnonymously, isFalse);
    });

    test('configure forwards multipleConversations', () async {
      await Clayver.configure(
        options: const ClayverOptions(multipleConversations: false),
      );
      final ClayverOptionsDto dto =
          api.calls.single.$2.single! as ClayverOptionsDto;
      expect(dto.multipleConversations, isFalse);
    });

    test('configure converts theme colors to ARGB ints and emulator', () async {
      await Clayver.configure(
        options: const ClayverOptions(
          projectId: 'acme',
          functionsRegion: 'europe-west1',
          databaseURL: 'https://acme-eu.europe-west1.firebasedatabase.app',
          firebaseAppName: 'secondary',
          theme: ClayverTheme(
            accentColor: Color(0xFF6200EE),
            customerTextColor: Color(0x80FFFFFF),
            fontFamily: 'Inter',
          ),
          emulator: ClayverEmulator(host: '10.0.2.2'),
        ),
      );
      final ClayverOptionsDto dto =
          api.calls.single.$2.single! as ClayverOptionsDto;
      expect(dto.projectId, 'acme');
      expect(dto.functionsRegion, 'europe-west1');
      expect(
        dto.databaseURL,
        'https://acme-eu.europe-west1.firebasedatabase.app',
      );
      expect(dto.firebaseAppName, 'secondary');
      expect(dto.theme!.accentColor, 0xFF6200EE);
      expect(dto.theme!.customerTextColor, 0x80FFFFFF);
      expect(dto.theme!.agentBubbleColor, isNull);
      expect(dto.theme!.fontFamily, 'Inter');
      expect(dto.emulator!.host, '10.0.2.2');
      expect(dto.emulator!.authPort, 9099);
      expect(dto.emulator!.databasePort, 9000);
      expect(dto.emulator!.functionsPort, 5001);
      expect(dto.emulator!.storagePort, 9199);
    });

    test('emulator host defaults to the native default', () async {
      await Clayver.configure(
        options: const ClayverOptions(emulator: ClayverEmulator()),
      );
      final ClayverOptionsDto dto =
          api.calls.single.$2.single! as ClayverOptionsDto;
      expect(dto.emulator!.host, isNull);
      expect(dto.emulator!.databasePort, 9000);
    });

    test('simple calls forward their arguments', () async {
      await Clayver.setPushToken('fcm-token');
      await Clayver.clearPushToken();
      await Clayver.openChat();
      await Clayver.openChat(conversationId: 'c9');
      await Clayver.markConversationRead('c3');
      await Clayver.openConversations();
      await Clayver.openNewConversation();
      await Clayver.deleteCustomerData();
      await Clayver.logout();
      expect(api.flat, [
        ['setPushToken', 'fcm-token'],
        ['clearPushToken'],
        ['openChat', null],
        ['openChat', 'c9'],
        ['markConversationRead', 'c3'],
        ['openConversations'],
        ['openNewConversation'],
        ['deleteCustomerData'],
        ['logout'],
      ]);
    });

    test('setUserProperties forwards supported values', () async {
      await Clayver.setUserProperties({
        'name': 'Ada',
        'age': 36,
        'score': 1.5,
        'pro': true,
      });
      expect(api.calls.single.$2.single, {
        'name': 'Ada',
        'age': 36,
        'score': 1.5,
        'pro': true,
      });
    });

    test(
      'setUserProperties rejects unsupported values without a native call',
      () async {
        await expectLater(
          Clayver.setUserProperties({
            'tags': ['a', 'b'],
          }),
          throwsA(
            isA<ClayverException>().having(
              (e) => e.code,
              'code',
              ClayverErrorCode.invalidArgument,
            ),
          ),
        );
        await expectLater(
          Clayver.setUserProperties({'x': double.nan}),
          throwsA(
            isA<ClayverException>().having(
              (e) => e.code,
              'code',
              ClayverErrorCode.invalidArgument,
            ),
          ),
        );
        expect(api.calls, isEmpty);
      },
    );

    test('getUnreadMessagesCount returns the native value', () async {
      api.unreadCount = 7;
      expect(await Clayver.getUnreadMessagesCount(), 7);
    });

    test('handleNotification stringifies values and drops nulls', () async {
      api.handled = true;
      final bool handled = await Clayver.handleNotification(<String, dynamic>{
        'clayver': '1',
        'conversationId': '-Nx',
        'n': 3,
        'nothing': null,
      });
      expect(handled, isTrue);
      expect(api.calls.single.$2.single, {
        'clayver': '1',
        'conversationId': '-Nx',
        'n': '3',
      });
    });

    test('isClayverNotification is a pure payload check', () {
      expect(
        Clayver.isClayverNotification({'clayver': '1', 'type': 'message'}),
        isTrue,
      );
      expect(Clayver.isClayverNotification({'clayver': 1}), isTrue);
      expect(Clayver.isClayverNotification({'type': 'message'}), isFalse);
      expect(Clayver.isClayverNotification({'clayver': '0'}), isFalse);
      expect(api.calls, isEmpty);
    });

    test(
      'sendMessage passes text, conversation and attachment bytes',
      () async {
        api.sent = messageDto('m1');
        final Uint8List bytes = Uint8List.fromList([1, 2, 3]);
        final ClayverMessage message = await Clayver.sendMessage(
          text: 'hello',
          conversationId: 'c1',
          attachment: ClayverAttachmentInput.bytes(
            bytes: bytes,
            fileName: 'a.png',
            contentType: 'image/png',
          ),
        );
        final List<Object?> args = api.calls.single.$2;
        expect(args[0], 'hello');
        expect(args[1], 'c1');
        final ClayverAttachmentInputDto input =
            args[2]! as ClayverAttachmentInputDto;
        expect(input.bytes, bytes);
        expect(input.filePath, isNull);
        expect(input.fileName, 'a.png');
        expect(input.contentType, 'image/png');
        expect(message.id, 'm1');
        expect(message.isFromCustomer, isTrue);
      },
    );

    test('startConversation passes text and attachment', () async {
      api.sent = messageDto('m3');
      final ClayverMessage message = await Clayver.startConversation(
        text: 'new topic',
        attachment: const ClayverAttachmentInput.file(
          filePath: '/tmp/a.jpg',
          fileName: 'a.jpg',
          contentType: 'image/jpeg',
        ),
      );
      final List<Object?> args = api.calls.single.$2;
      expect(api.calls.single.$1, 'startConversation');
      expect(args[0], 'new topic');
      expect((args[1]! as ClayverAttachmentInputDto).filePath, '/tmp/a.jpg');
      expect(message.id, 'm3');
      expect(message.conversationId, 'c1');

      await Clayver.startConversation(text: 'only text');
      expect(api.flat.last, ['startConversation', 'only text', null]);
    });

    test('new customer calls map native errors', () async {
      api.sent = messageDto('m');
      api.error = PlatformException(code: 'permissionDenied', message: 'x');
      for (final Future<Object?> Function() call in [
        () => Clayver.openConversations(),
        () => Clayver.openNewConversation(),
        () => Clayver.startConversation(text: 't'),
        () => Clayver.deleteCustomerData(),
      ]) {
        await expectLater(
          call(),
          throwsA(
            isA<ClayverException>().having(
              (e) => e.code,
              'code',
              ClayverErrorCode.permissionDenied,
            ),
          ),
        );
      }
    });

    test('sendMessage with a file path attachment', () async {
      api.sent = messageDto('m2');
      await Clayver.sendMessage(
        attachment: const ClayverAttachmentInput.file(
          filePath: '/tmp/a.jpg',
          fileName: 'a.jpg',
          contentType: 'image/jpeg',
        ),
      );
      final List<Object?> args = api.calls.single.$2;
      expect(args[0], isNull);
      expect(args[1], isNull);
      final ClayverAttachmentInputDto input =
          args[2]! as ClayverAttachmentInputDto;
      expect(input.filePath, '/tmp/a.jpg');
      expect(input.bytes, isNull);
    });

    test('loadOlderMessages forwards paging arguments and decodes', () async {
      api.olderMessages = [messageDto('a'), messageDto('b')];
      final List<ClayverMessage> page = await Clayver.loadOlderMessages(
        'c1',
        before: 'm9',
        limit: 20,
      );
      expect(api.flat.single, ['loadOlderMessages', 'c1', 'm9', 20]);
      expect(page.map((m) => m.id), ['a', 'b']);
      final ClayverMessage first = page.first;
      expect(first.senderType, ClayverSenderType.customer);
      expect(
        first.createdAt,
        DateTime.fromMillisecondsSinceEpoch(1700000000000, isUtc: true),
      );
      expect(first.attachment!.width, 10);
      expect(first.attachment!.contentType, 'image/png');
      expect(first.clientMessageId, 'local-a');

      await Clayver.loadOlderMessages('c2', before: 'm1');
      expect(api.flat.last, ['loadOlderMessages', 'c2', 'm1', 30]);
    });
  });

  group('agent mode', () {
    test(
      'agentRole parses the native role and forwards forceRefresh',
      () async {
        api.role = 'admin';
        expect(await Clayver.agentRole(), ClayverAgentRole.admin);
        expect((await Clayver.agentRole())!.isAdmin, isTrue);
        api.role = 'agent';
        expect(
          await Clayver.agentRole(forceRefresh: true),
          ClayverAgentRole.agent,
        );
        api.role = null;
        expect(await Clayver.agentRole(), isNull);
        api.role = 'owner';
        expect(await Clayver.agentRole(), isNull);
        expect(api.flat.map((c) => c[1]), [false, false, true, false, false]);
      },
    );

    test('isAgent forwards to native', () async {
      api.agent = true;
      expect(await Clayver.isAgent(), isTrue);
      expect(api.flat, [
        ['isAgent'],
      ]);
    });

    test('sendAgentReply passes conversation, text and attachment', () async {
      api.sent = ClayverMessageDto(
        id: 'r1',
        conversationId: 'c1',
        senderId: 'agent-uid',
        senderType: 'agent',
        senderName: 'Grace',
        text: 'On it',
        createdAt: 5,
      );
      final ClayverMessage reply = await Clayver.sendAgentReply(
        conversationId: 'c1',
        text: 'On it',
        attachment: const ClayverAttachmentInput.file(
          filePath: '/tmp/r.jpg',
          fileName: 'r.jpg',
          contentType: 'image/jpeg',
        ),
      );
      final List<Object?> args = api.calls.single.$2;
      expect(args[0], 'c1');
      expect(args[1], 'On it');
      expect((args[2]! as ClayverAttachmentInputDto).filePath, '/tmp/r.jpg');
      expect(reply.senderType, ClayverSenderType.agent);
      expect(reply.senderName, 'Grace');
      expect(reply.isFromCustomer, isFalse);

      await Clayver.sendAgentReply(conversationId: 'c2', text: 'x');
      expect(api.flat.last, ['sendAgentReply', 'c2', 'x', null]);
    });

    test('status, assignment and team read marker', () async {
      await Clayver.setConversationStatus(
        'c1',
        ClayverConversationStatus.closed,
      );
      await Clayver.setConversationStatus('c1', ClayverConversationStatus.open);
      await Clayver.assignConversation('c1', toMe: true);
      await Clayver.assignConversation('c1', toMe: false);
      await Clayver.markConversationReadAsAgent('c1');
      await Clayver.addTag('c1', 'billing');
      await Clayver.removeTag('c1', 'billing');
      expect(api.flat, [
        ['setConversationStatus', 'c1', 'closed'],
        ['setConversationStatus', 'c1', 'open'],
        ['assignConversation', 'c1', true],
        ['assignConversation', 'c1', false],
        ['markConversationReadAsAgent', 'c1'],
        ['addTag', 'c1', 'billing'],
        ['removeTag', 'c1', 'billing'],
      ]);
    });

    test('createTag forwards name and color and decodes the tag', () async {
      api.createdTag = ClayverTagDto(
        id: 'vip-customer',
        name: 'VIP customer',
        color: '#7c3aed',
      );
      final ClayverTag tag = await Clayver.createTag('VIP customer');
      expect(tag.id, 'vip-customer');
      expect(tag.name, 'VIP customer');
      expect(tag.color, '#7c3aed');
      expect(
        tag,
        const ClayverTag(
          id: 'vip-customer',
          name: 'VIP customer',
          color: '#7c3aed',
        ),
      );
      await Clayver.createTag('Bug', color: '#ff0000');
      expect(api.flat, [
        ['createTag', 'VIP customer', null],
        ['createTag', 'Bug', '#ff0000'],
      ]);
    });

    test(
      'setConversationStatus rejects unknown without a native call',
      () async {
        await expectLater(
          Clayver.setConversationStatus(
            'c1',
            ClayverConversationStatus.unknown,
          ),
          throwsA(
            isA<ClayverException>().having(
              (e) => e.code,
              'code',
              ClayverErrorCode.invalidArgument,
            ),
          ),
        );
        expect(api.calls, isEmpty);
      },
    );

    test(
      'agentConversations validates status and limit without a native call',
      () async {
        for (final Stream<List<ClayverAgentConversation>> s in [
          Clayver.agentConversations(status: ClayverConversationStatus.unknown),
          Clayver.agentConversations(limit: 0),
        ]) {
          await expectLater(
            s.first,
            throwsA(
              isA<ClayverException>().having(
                (e) => e.code,
                'code',
                ClayverErrorCode.invalidArgument,
              ),
            ),
          );
        }
        expect(api.calls, isEmpty);
      },
    );

    final Map<String, Future<Object?> Function()> agentCalls = {
      'agentRole': () => Clayver.agentRole(),
      'isAgent': () => Clayver.isAgent(),
      'sendAgentReply': () =>
          Clayver.sendAgentReply(conversationId: 'c', text: 't'),
      'setConversationStatus': () =>
          Clayver.setConversationStatus('c', ClayverConversationStatus.open),
      'assignConversation': () => Clayver.assignConversation('c', toMe: true),
      'markConversationReadAsAgent': () =>
          Clayver.markConversationReadAsAgent('c'),
      'createTag': () => Clayver.createTag('Bug'),
      'addTag': () => Clayver.addTag('c', 'bug'),
      'removeTag': () => Clayver.removeTag('c', 'bug'),
    };
    for (final MapEntry<String, Future<Object?> Function()> call
        in agentCalls.entries) {
      test('${call.key} maps permissionDenied', () async {
        api.sent = messageDto('m');
        api.error = PlatformException(
          code: 'permissionDenied',
          message: 'not an agent',
        );
        await expectLater(
          call.value(),
          throwsA(
            isA<ClayverException>()
                .having(
                  (e) => e.code,
                  'code',
                  ClayverErrorCode.permissionDenied,
                )
                .having((e) => e.message, 'message', 'not an agent'),
          ),
        );
      });
    }

    test('agent conversation and profile models', () {
      final ClayverAgentConversation c = ClayverAgentConversation.fromDto(
        ClayverAgentConversationDto(
          id: 'c1',
          customerId: 'v_abcdef123456',
          status: 'closed',
          createdAt: 1000,
          unreadForAgents: 3,
          assigneeUid: 'uid-1',
          lastMessage: ClayverLastMessageDto(
            text: 'help',
            senderType: 'customer',
            createdAt: 1500,
            hasAttachment: true,
          ),
        ),
      );
      expect(c.status, ClayverConversationStatus.closed);
      expect(c.customerId, 'v_abcdef123456');
      expect(c.unreadForAgents, 3);
      expect(c.assigneeUid, 'uid-1');
      expect(c.updatedAt, isNull);
      expect(
        c.lastActivityAt,
        DateTime.fromMillisecondsSinceEpoch(1500, isUtc: true),
      );
      expect(c.lastMessage!.hasAttachment, isTrue);

      final ClayverCustomerProfile p = ClayverCustomerProfile.fromDto(
        ClayverCustomerProfileDto(
          customerId: 'abcdef123456',
          properties: {
            '_name': ' Ada ',
            '_email': 'ada@x.io',
            '_uid': 'u-42',
            'seats': 5,
            'gone': null,
          },
          lastSeenAt: 2000,
        ),
      );
      expect(p.name, 'Ada');
      expect(p.email, 'ada@x.io');
      expect(p.displayName, 'Ada');
      expect(p.userId, 'u-42');
      expect(p.properties, {
        '_name': ' Ada ',
        '_email': 'ada@x.io',
        '_uid': 'u-42',
        'seats': 5,
      });
      expect(
        p.lastSeenAt,
        DateTime.fromMillisecondsSinceEpoch(2000, isUtc: true),
      );

      expect(
        const ClayverCustomerProfile(
          customerId: 'abcdef123456',
          properties: {},
          account: ClayverCustomerAccount(
            anonymous: false,
            emailVerified: true,
            email: 'user-1@example.com',
          ),
        ).displayName,
        'user-1@example.com',
      );
      expect(
        const ClayverCustomerProfile(
          customerId: 'abcdef123456',
          properties: {},
        ).displayName,
        'abcdef12',
      );
      expect(
        const ClayverCustomerProfile(
          customerId: '',
          properties: {},
        ).displayName,
        'Customer',
      );
    });

    test(
      'handleNotification forwards agent-audience pushes for native routing',
      () async {
        api.handled = true;
        expect(
          await Clayver.handleNotification({
            'clayver': '1',
            'audience': 'agent',
            'conversationId': '-Nx',
          }),
          isTrue,
        );
        expect(api.calls.single.$2.single, {
          'clayver': '1',
          'audience': 'agent',
          'conversationId': '-Nx',
        });
      },
    );
  });

  group('error mapping', () {
    for (final String code in ClayverErrorCode.values) {
      test('native code $code becomes ClayverException($code)', () async {
        api.error = PlatformException(
          code: code,
          message: 'boom',
          details: 'd',
        );
        await expectLater(
          Clayver.logout(),
          throwsA(
            isA<ClayverException>()
                .having((e) => e.code, 'code', code)
                .having((e) => e.message, 'message', 'boom')
                .having((e) => e.details, 'details', 'd'),
          ),
        );
      });
    }

    test(
      'unknown platform codes become internal and keep the original code',
      () async {
        api.error = PlatformException(code: 'channel-error', message: 'nope');
        await expectLater(
          Clayver.getUnreadMessagesCount(),
          throwsA(
            isA<ClayverException>()
                .having((e) => e.code, 'code', ClayverErrorCode.internal)
                .having(
                  (e) => (e.details! as Map)['platformCode'],
                  'platformCode',
                  'channel-error',
                ),
          ),
        );
      },
    );

    test('MissingPluginException becomes internal', () async {
      api.error = MissingPluginException('no impl');
      await expectLater(
        Clayver.openChat(),
        throwsA(
          isA<ClayverException>().having(
            (e) => e.code,
            'code',
            ClayverErrorCode.internal,
          ),
        ),
      );
    });
  });

  group('enum parsing', () {
    test('block status reasons and dates', () {
      expect(ClayverBlockReason.parse('spam'), ClayverBlockReason.spam);
      expect(ClayverBlockReason.parse('abuse'), ClayverBlockReason.abuse);
      expect(
        ClayverBlockReason.parse('rate_limit'),
        ClayverBlockReason.rateLimit,
      );
      expect(ClayverBlockReason.parse('other'), ClayverBlockReason.other);
      expect(ClayverBlockReason.parse('fraud'), ClayverBlockReason.other);
      expect(ClayverBlockReason.parse(null), ClayverBlockReason.other);

      final ClayverBlockStatus timed = ClayverBlockStatus.fromDto(
        ClayverBlockStatusDto(reason: 'rate_limit', until: 6000),
      );
      expect(timed.reason, ClayverBlockReason.rateLimit);
      expect(
        timed.until,
        DateTime.fromMillisecondsSinceEpoch(6000, isUtc: true),
      );
      final ClayverBlockStatus open = ClayverBlockStatus.fromDto(
        ClayverBlockStatusDto(reason: 'abuse'),
      );
      expect(open.until, isNull);
      expect(open, const ClayverBlockStatus(reason: ClayverBlockReason.abuse));
    });

    test('unknown wire values do not throw', () {
      expect(ClayverSenderType.parse('bot'), ClayverSenderType.unknown);
      expect(
        ClayverConversationStatus.parse('snoozed'),
        ClayverConversationStatus.unknown,
      );
      expect(
        ClayverConversationStatus.parse('closed'),
        ClayverConversationStatus.closed,
      );
    });
  });
}
