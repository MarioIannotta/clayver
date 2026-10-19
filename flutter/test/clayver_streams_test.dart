import 'dart:async';

import 'package:clayver/clayver.dart';
import 'package:clayver/src/messages.g.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const String _events = 'dev.flutter.pigeon.clayver.ClayverEventApi';
const String _host = 'dev.flutter.pigeon.clayver.ClayverHostApi';

TestDefaultBinaryMessenger get _messenger =>
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

/// Mocks one Pigeon event channel and records listen/cancel calls.
class FakeEventChannel {
  FakeEventChannel(String name) {
    _messenger.setMockStreamHandler(
      EventChannel(name, pigeonMethodCodec),
      MockStreamHandler.inline(
        onListen: (Object? args, MockStreamHandlerEventSink sink) {
          listens++;
          this.sink = sink;
        },
        onCancel: (Object? args) {
          cancels++;
          sink = null;
        },
      ),
    );
  }

  int listens = 0;
  int cancels = 0;
  MockStreamHandlerEventSink? sink;
}

/// Mocks a Pigeon host method over the real codec.
List<List<Object?>> mockHost(String method, [Object? reply]) {
  final List<List<Object?>> received = [];
  _messenger.setMockDecodedMessageHandler<Object?>(
    BasicMessageChannel<Object?>(
      '$_host.$method',
      ClayverHostApi.pigeonChannelCodec,
    ),
    (Object? message) async {
      received.add((message as List<Object?>?) ?? const []);
      return <Object?>[reply];
    },
  );
  return received;
}

ClayverConversationDto conversationDto(String id, {int unread = 0}) =>
    ClayverConversationDto(
      id: id,
      status: 'open',
      createdAt: 1000,
      updatedAt: 2000,
      unreadCount: unread,
      lastMessage: ClayverLastMessageDto(
        text: 'Welcome!',
        senderType: 'system',
        createdAt: 2000,
        hasAttachment: false,
      ),
    );

ClayverMessageDto messageDto(String id, String conversationId) =>
    ClayverMessageDto(
      id: id,
      conversationId: conversationId,
      senderId: 'agent-uid',
      senderType: 'agent',
      senderName: 'Grace',
      text: 'Hello',
      createdAt: 3000,
    );

ClayverAgentConversationDto agentConversationDto(String id) =>
    ClayverAgentConversationDto(
      id: id,
      customerId: 'v_$id',
      status: 'open',
      updatedAt: 4000,
      unreadForAgents: 1,
    );

Future<void> pump() => Future<void>.delayed(Duration.zero);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(Clayver.resetForTesting);

  test('host calls are encoded with the Pigeon codec', () async {
    final List<List<Object?>> configure = mockHost('configure');
    final List<List<Object?>> count = mockHost('getUnreadMessagesCount', 5);
    await Clayver.configure(options: const ClayverOptions(projectId: 'acme'));
    expect((configure.single.single! as ClayverOptionsDto).projectId, 'acme');
    expect(await Clayver.getUnreadMessagesCount(), 5);
    expect(count, hasLength(1));
  });

  test('a native error reply becomes a ClayverException', () async {
    _messenger.setMockDecodedMessageHandler<Object?>(
      BasicMessageChannel<Object?>(
        '$_host.logout',
        ClayverHostApi.pigeonChannelCodec,
      ),
      (Object? message) async => <Object?>[
        'notAuthenticated',
        'not signed in',
        null,
      ],
    );
    await expectLater(
      Clayver.logout(),
      throwsA(
        isA<ClayverException>()
            .having((e) => e.code, 'code', ClayverErrorCode.notAuthenticated)
            .having((e) => e.message, 'message', 'not signed in'),
      ),
    );
  });

  test('a missing native implementation becomes internal', () async {
    // No mock handler: Pigeon reports `channel-error`.
    await expectLater(
      Clayver.logout(),
      throwsA(
        isA<ClayverException>().having(
          (e) => e.code,
          'code',
          ClayverErrorCode.internal,
        ),
      ),
    );
  });

  group('unreadCountStream', () {
    test(
      'decodes values, shares one native listener and replays the latest',
      () async {
        final FakeEventChannel channel = FakeEventChannel(
          '$_events.unreadCount',
        );
        final List<int> a = [];
        final List<int> b = [];
        final StreamSubscription<int> subA = Clayver.unreadCountStream.listen(
          a.add,
        );
        await pump();
        channel.sink!.success(3);
        await pump();
        final StreamSubscription<int> subB = Clayver.unreadCountStream.listen(
          b.add,
        );
        await pump();
        channel.sink!.success(4);
        await pump();

        expect(a, [3, 4]);
        expect(b, [3, 4]);
        expect(channel.listens, 1);

        await subA.cancel();
        expect(channel.cancels, 0);
        await subB.cancel();
        await pump();
        expect(channel.cancels, 1);

        // A new listener restarts the native stream without a stale value.
        final List<int> c = [];
        final StreamSubscription<int> subC = Clayver.unreadCountStream.listen(
          c.add,
        );
        await pump();
        expect(channel.listens, 2);
        expect(c, isEmpty);
        await subC.cancel();
      },
    );

    test('maps native errors and closes listeners at end of stream', () async {
      final FakeEventChannel channel = FakeEventChannel('$_events.unreadCount');
      final List<Object> errors = [];
      final Completer<void> done = Completer<void>();
      Clayver.unreadCountStream.listen(
        (_) {},
        onError: errors.add,
        onDone: done.complete,
      );
      await pump();
      channel.sink!.error(code: 'permissionDenied', message: 'rules');
      channel.sink!.endOfStream();
      await done.future;
      expect(
        errors.single,
        isA<ClayverException>()
            .having((e) => e.code, 'code', ClayverErrorCode.permissionDenied)
            .having((e) => e.message, 'message', 'rules'),
      );
    });
  });

  test('conversations() decodes Pigeon objects into models', () async {
    final FakeEventChannel channel = FakeEventChannel('$_events.conversations');
    final Future<List<ClayverConversation>> first =
        Clayver.conversations().first;
    await pump();
    channel.sink!.success([
      conversationDto('c1', unread: 2),
      conversationDto('c2'),
    ]);
    final List<ClayverConversation> list = await first;
    expect(list.map((c) => c.id), ['c1', 'c2']);
    expect(list.first.unreadCount, 2);
    expect(list.first.status, ClayverConversationStatus.open);
    expect(
      list.first.updatedAt,
      DateTime.fromMillisecondsSinceEpoch(2000, isUtc: true),
    );
    expect(list.first.lastMessage!.senderType, ClayverSenderType.system);
    expect(list.first.lastMessage!.text, 'Welcome!');
    await pump();
    expect(channel.cancels, 1);
  });

  group('messages()', () {
    test(
      'registers a per-subscription channel and unregisters it on cancel',
      () async {
        final List<List<Object?>> registered = mockHost(
          'registerMessagesChannel',
        );
        final List<List<Object?>> unregistered = mockHost(
          'unregisterMessagesChannel',
        );
        final FakeEventChannel m0 = FakeEventChannel('$_events.messages.m0');
        final FakeEventChannel m1 = FakeEventChannel('$_events.messages.m1');

        final List<List<ClayverMessage>> c1 = [];
        final List<List<ClayverMessage>> c2 = [];
        final StreamSubscription<List<ClayverMessage>> s1 = Clayver.messages(
          'c1',
        ).listen(c1.add);
        await pump();
        final StreamSubscription<List<ClayverMessage>> s2 = Clayver.messages(
          'c2',
        ).listen(c2.add);
        await pump();
        // Same conversation again shares the first native stream.
        final StreamSubscription<List<ClayverMessage>> s1b = Clayver.messages(
          'c1',
        ).listen((_) {});
        await pump();

        expect(registered, [
          ['m0', 'c1'],
          ['m1', 'c2'],
        ]);
        expect(m0.listens, 1);
        expect(m1.listens, 1);

        m0.sink!.success([messageDto('a', 'c1')]);
        m1.sink!.success([messageDto('b', 'c2'), messageDto('c', 'c2')]);
        await pump();
        expect(c1.single.single.id, 'a');
        expect(c1.single.single.senderName, 'Grace');
        expect(c1.single.single.senderType, ClayverSenderType.agent);
        expect(c2.single.map((m) => m.id), ['b', 'c']);

        await s1.cancel();
        await s1b.cancel();
        await pump();
        expect(m0.cancels, 1);
        expect(unregistered, [
          ['m0'],
        ]);
        expect(m1.cancels, 0);

        await s2.cancel();
        await pump();
        expect(unregistered.last, ['m1']);
      },
    );

    test('a failed registration surfaces as a ClayverException', () async {
      _messenger.setMockDecodedMessageHandler<Object?>(
        BasicMessageChannel<Object?>(
          '$_host.registerMessagesChannel',
          ClayverHostApi.pigeonChannelCodec,
        ),
        (Object? message) async => <Object?>[
          'notConfigured',
          'configure first',
          null,
        ],
      );
      mockHost('unregisterMessagesChannel');
      await expectLater(
        Clayver.messages('c1').first,
        throwsA(
          isA<ClayverException>().having(
            (e) => e.code,
            'code',
            ClayverErrorCode.notConfigured,
          ),
        ),
      );
    });
  });

  group('agentConversations()', () {
    test('one channel per status+limit, shared and unregistered', () async {
      final List<List<Object?>> registered = mockHost(
        'registerAgentConversationsChannel',
      );
      final List<List<Object?>> unregistered = mockHost(
        'unregisterAgentConversationsChannel',
      );
      final FakeEventChannel a0 = FakeEventChannel(
        '$_events.agentConversations.a0',
      );
      final FakeEventChannel a1 = FakeEventChannel(
        '$_events.agentConversations.a1',
      );
      final FakeEventChannel a2 = FakeEventChannel(
        '$_events.agentConversations.a2',
      );

      final List<List<ClayverAgentConversation>> open = [];
      final StreamSubscription<List<ClayverAgentConversation>> s1 =
          Clayver.agentConversations().listen(open.add);
      await pump();
      final StreamSubscription<List<ClayverAgentConversation>> s1b =
          Clayver.agentConversations(limit: 50).listen((_) {});
      await pump();
      final StreamSubscription<List<ClayverAgentConversation>> s2 =
          Clayver.agentConversations(
            status: ClayverConversationStatus.closed,
            limit: 10,
          ).listen((_) {});
      await pump();
      // A tag filter gets its own channel.
      final StreamSubscription<List<ClayverAgentConversation>> s3 =
          Clayver.agentConversations(tagId: 'billing').listen((_) {});
      await pump();

      expect(registered, [
        ['a0', 'open', 50, null],
        ['a1', 'closed', 10, null],
        ['a2', 'open', 50, 'billing'],
      ]);
      expect(a0.listens, 1);
      expect(a1.listens, 1);
      expect(a2.listens, 1);

      a0.sink!.success([
        agentConversationDto('c1'),
        agentConversationDto('c2'),
      ]);
      await pump();
      expect(open.single.map((c) => c.id), ['c1', 'c2']);
      expect(open.single.first.customerId, 'v_c1');
      expect(open.single.first.unreadForAgents, 1);
      expect(open.single.first.status, ClayverConversationStatus.open);

      await s1.cancel();
      await s1b.cancel();
      await pump();
      expect(a0.cancels, 1);
      expect(unregistered, [
        ['a0'],
      ]);
      await s2.cancel();
      await pump();
      expect(unregistered.last, ['a1']);
      await s3.cancel();
      await pump();
      expect(unregistered.last, ['a2']);
    });

    test('a native permissionDenied error ends the stream', () async {
      mockHost('registerAgentConversationsChannel');
      final List<List<Object?>> unregistered = mockHost(
        'unregisterAgentConversationsChannel',
      );
      final FakeEventChannel a0 = FakeEventChannel(
        '$_events.agentConversations.a0',
      );
      final List<Object> errors = [];
      final Completer<void> done = Completer<void>();
      Clayver.agentConversations().listen(
        (_) {},
        onError: errors.add,
        onDone: done.complete,
      );
      await pump();
      a0.sink!.error(code: 'permissionDenied', message: 'not an agent');
      a0.sink!.endOfStream();
      await done.future;
      expect(
        errors.single,
        isA<ClayverException>().having(
          (e) => e.code,
          'code',
          ClayverErrorCode.permissionDenied,
        ),
      );
      await pump();
      expect(unregistered, [
        ['a0'],
      ]);
    });
  });

  group('customerProfile()', () {
    test('registers per customer and decodes the profile', () async {
      final List<List<Object?>> registered = mockHost(
        'registerCustomerProfileChannel',
      );
      final List<List<Object?>> unregistered = mockHost(
        'unregisterCustomerProfileChannel',
      );
      final FakeEventChannel p0 = FakeEventChannel(
        '$_events.customerProfile.p0',
      );
      final Future<ClayverCustomerProfile> first = Clayver.customerProfile(
        'v_abc',
      ).first;
      await pump();
      expect(registered, [
        ['p0', 'v_abc'],
      ]);
      p0.sink!.success(
        ClayverCustomerProfileDto(
          customerId: 'v_abc',
          account: ClayverCustomerAccountDto(
            anonymous: false,
            email: 'ada@example.com',
            emailVerified: true,
          ),
          properties: {'_name': 'Ada', 'beta': true, 'score': 1.5},
          lastSeenAt: 9000,
        ),
      );
      final ClayverCustomerProfile profile = await first;
      expect(profile.displayName, 'Ada');
      expect(profile.account!.email, 'ada@example.com');
      expect(profile.account!.emailVerified, isTrue);
      expect(profile.properties['beta'], isTrue);
      expect(profile.properties['score'], 1.5);
      expect(
        profile.lastSeenAt,
        DateTime.fromMillisecondsSinceEpoch(9000, isUtc: true),
      );
      await pump();
      expect(p0.cancels, 1);
      expect(unregistered, [
        ['p0'],
      ]);
    });

    test('a failed registration surfaces as a ClayverException', () async {
      _messenger.setMockDecodedMessageHandler<Object?>(
        BasicMessageChannel<Object?>(
          '$_host.registerCustomerProfileChannel',
          ClayverHostApi.pigeonChannelCodec,
        ),
        (Object? message) async => <Object?>[
          'permissionDenied',
          'agents only',
          null,
        ],
      );
      mockHost('unregisterCustomerProfileChannel');
      await expectLater(
        Clayver.customerProfile('v_abc').first,
        throwsA(
          isA<ClayverException>().having(
            (e) => e.code,
            'code',
            ClayverErrorCode.permissionDenied,
          ),
        ),
      );
    });
  });

  group('blockStatus()', () {
    test('decodes blocks and null, sharing one native listener', () async {
      final FakeEventChannel channel = FakeEventChannel('$_events.blockStatus');
      final List<ClayverBlockStatus?> a = [];
      final List<ClayverBlockStatus?> b = [];
      final StreamSubscription<ClayverBlockStatus?> subA = Clayver.blockStatus()
          .listen(a.add);
      await pump();
      channel.sink!.success(ClayverBlockStateDto());
      await pump();
      channel.sink!.success(
        ClayverBlockStateDto(
          status: ClayverBlockStatusDto(reason: 'rate_limit', until: 7000),
        ),
      );
      await pump();
      final StreamSubscription<ClayverBlockStatus?> subB = Clayver.blockStatus()
          .listen(b.add);
      await pump();
      channel.sink!.success(
        ClayverBlockStateDto(
          status: ClayverBlockStatusDto(reason: 'something-new'),
        ),
      );
      await pump();

      expect(channel.listens, 1);
      expect(a, [
        null,
        ClayverBlockStatus(
          reason: ClayverBlockReason.rateLimit,
          until: DateTime.fromMillisecondsSinceEpoch(7000, isUtc: true),
        ),
        const ClayverBlockStatus(reason: ClayverBlockReason.other),
      ]);
      // The second listener gets the latest value first.
      expect(b, [a[1], a[2]]);

      await subA.cancel();
      await subB.cancel();
      await pump();
      expect(channel.cancels, 1);
    });

    test('maps native errors', () async {
      final FakeEventChannel channel = FakeEventChannel('$_events.blockStatus');
      final List<Object> errors = [];
      final Completer<void> done = Completer<void>();
      Clayver.blockStatus().listen(
        (_) {},
        onError: errors.add,
        onDone: done.complete,
      );
      await pump();
      channel.sink!.error(code: 'notConfigured', message: 'configure first');
      channel.sink!.endOfStream();
      await done.future;
      expect(
        errors.single,
        isA<ClayverException>().having(
          (e) => e.code,
          'code',
          ClayverErrorCode.notConfigured,
        ),
      );
    });
  });

  test('tags() decodes the catalog', () async {
    final FakeEventChannel channel = FakeEventChannel('$_events.tags');
    final Future<List<ClayverTag>> first = Clayver.tags().first;
    await pump();
    channel.sink!.success([
      ClayverTagDto(id: 'billing', name: 'Billing', color: '#2563eb'),
      ClayverTagDto(id: 'bug', name: 'Bug', color: '#dc2626'),
    ]);
    final List<ClayverTag> tags = await first;
    expect(tags.map((t) => t.id), ['billing', 'bug']);
    expect(tags.first.name, 'Billing');
    expect(tags.last.color, '#dc2626');
    await pump();
    expect(channel.cancels, 1);
  });

  group('conversationTags()', () {
    test('registers per conversation, shares and unregisters', () async {
      final List<List<Object?>> registered = mockHost(
        'registerConversationTagsChannel',
      );
      final List<List<Object?>> unregistered = mockHost(
        'unregisterConversationTagsChannel',
      );
      final FakeEventChannel t0 = FakeEventChannel(
        '$_events.conversationTags.t0',
      );
      final FakeEventChannel t1 = FakeEventChannel(
        '$_events.conversationTags.t1',
      );
      final List<List<String>> c1 = [];
      final StreamSubscription<List<String>> s1 = Clayver.conversationTags(
        'c1',
      ).listen(c1.add);
      await pump();
      final StreamSubscription<List<String>> s1b = Clayver.conversationTags(
        'c1',
      ).listen((_) {});
      await pump();
      final StreamSubscription<List<String>> s2 = Clayver.conversationTags(
        'c2',
      ).listen((_) {});
      await pump();
      expect(registered, [
        ['t0', 'c1'],
        ['t1', 'c2'],
      ]);
      expect(t0.listens, 1);
      expect(t1.listens, 1);

      t0.sink!.success(<String>['billing', 'vip']);
      await pump();
      t0.sink!.success(<String>[]);
      await pump();
      expect(c1, [
        ['billing', 'vip'],
        <String>[],
      ]);

      await s1.cancel();
      await s1b.cancel();
      await pump();
      expect(t0.cancels, 1);
      expect(unregistered, [
        ['t0'],
      ]);
      await s2.cancel();
      await pump();
      expect(unregistered.last, ['t1']);
    });

    test('a failed registration surfaces as a ClayverException', () async {
      _messenger.setMockDecodedMessageHandler<Object?>(
        BasicMessageChannel<Object?>(
          '$_host.registerConversationTagsChannel',
          ClayverHostApi.pigeonChannelCodec,
        ),
        (Object? message) async => <Object?>[
          'permissionDenied',
          'agents only',
          null,
        ],
      );
      mockHost('unregisterConversationTagsChannel');
      await expectLater(
        Clayver.conversationTags('c1').first,
        throwsA(
          isA<ClayverException>().having(
            (e) => e.code,
            'code',
            ClayverErrorCode.permissionDenied,
          ),
        ),
      );
    });
  });
}
