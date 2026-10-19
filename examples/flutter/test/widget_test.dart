import 'package:clayver/clayver.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Clayver pushes are recognised from their data payload', () {
    expect(
      Clayver.isClayverNotification({
        'clayver': '1',
        'type': 'message',
        'conversationId': '-Nx',
      }),
      isTrue,
    );
    expect(Clayver.isClayverNotification({'type': 'promo'}), isFalse);
  });

  test('agent pushes are Clayver pushes too (routed natively)', () {
    expect(
      Clayver.isClayverNotification({
        'clayver': '1',
        'audience': 'agent',
        'conversationId': '-Nx',
      }),
      isTrue,
    );
  });
}
