import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:roadlink_shared/roadlink_shared.dart';

/// A phone with no Firebase: the test decides what the system would answer.
class FakeSource implements PushSource {
  FakeSource({this.allowed = true, this.currentToken = 'token-1', this.throwOnToken = false});

  bool allowed;
  String? currentToken;
  bool throwOnToken;
  final refreshes = StreamController<String>.broadcast();
  int permissionAsked = 0;

  @override
  Future<bool> requestPermission() async {
    permissionAsked++;
    return allowed;
  }

  @override
  Future<String?> token() async {
    if (throwOnToken) throw StateError('Firebase is not initialised');
    return currentToken;
  }

  @override
  Stream<String> get tokenRefreshes => refreshes.stream;
}

Future<void> settle() => Future<void>.delayed(Duration.zero);

void main() {
  group('PushService', () {
    late List<String> registered;
    late int cleared;

    PushService build(FakeSource source, {Future<void> Function(String)? register}) {
      registered = [];
      cleared = 0;
      return PushService(
        register: register ?? (t) async => registered.add(t),
        clear: () async => cleared++,
        source: source,
      );
    }

    test('asks permission, registers this phone\'s token and follows rotations', () async {
      final source = FakeSource();
      final push = build(source);

      expect(await push.start(), isTrue);
      expect(source.permissionAsked, 1);
      expect(registered, ['token-1']);
      expect(push.active, isTrue);

      source.refreshes.add('token-2');
      await settle();
      expect(registered, ['token-1', 'token-2'], reason: 'Firebase rotated the token, so Core must be told');
    });

    test('does nothing when the user refuses alerts', () async {
      final source = FakeSource(allowed: false);
      final push = build(source);

      expect(await push.start(), isFalse);
      expect(registered, isEmpty);
      expect(push.active, isFalse);
    });

    test('does nothing when the phone has no token', () async {
      expect(await build(FakeSource(currentToken: null)).start(), isFalse);
      expect(registered, isEmpty);
      expect(await build(FakeSource(currentToken: '')).start(), isFalse);
      expect(registered, isEmpty);
    });

    test('never throws into the app: Firebase missing, or Core unreachable', () async {
      expect(await build(FakeSource(throwOnToken: true)).start(), isFalse);

      final offline = build(FakeSource(), register: (t) async => throw StateError('network down'));
      expect(await offline.start(), isFalse);
      expect(offline.active, isFalse, reason: 'it can try again at the next sign-in');
    });

    test('a failed re-registration of a rotated token is swallowed', () async {
      final source = FakeSource();
      var calls = 0;
      final push = build(source, register: (t) async {
        calls++;
        if (calls > 1) throw StateError('network down');
      });

      expect(await push.start(), isTrue);
      source.refreshes.add('token-2');
      await settle(); // would surface as an unhandled async error and fail this test if it were not caught
      expect(calls, 2);
    });

    test('sign-out stops following rotations and tells Core to stop pushing here', () async {
      final source = FakeSource();
      final push = build(source);
      await push.start();

      await push.stop();
      expect(cleared, 1);
      expect(push.active, isFalse);

      source.refreshes.add('token-3');
      await settle();
      expect(registered, ['token-1'], reason: 'no registrations after sign-out');
    });

    test('when the session already expired, it does not call the server', () async {
      final push = build(FakeSource());
      await push.start();
      await push.stop(tellServer: false);
      expect(cleared, 0);
      expect(push.active, isFalse);
    });

    test('a failing clear call does not break sign-out', () async {
      final push = PushService(
        register: (t) async {},
        clear: () async => throw StateError('401'),
        source: FakeSource(),
      );
      await push.start();
      await push.stop(); // must complete normally
      expect(push.active, isFalse);
    });
  });
}
