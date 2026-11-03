import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

/// Where the phone's push token comes from. Firebase in the apps; a fake in the tests.
abstract class PushSource {
  /// Ask the user for permission to show alerts (Android 13+ shows a prompt). False if refused.
  Future<bool> requestPermission();

  /// This phone's current token, or null if it has none.
  Future<String?> token();

  /// Firebase rotates tokens now and then; each new one arrives here.
  Stream<String> get tokenRefreshes;
}

class FirebasePushSource implements PushSource {
  FirebaseMessaging get _messaging => FirebaseMessaging.instance;

  @override
  Future<bool> requestPermission() async {
    final settings = await _messaging.requestPermission(alert: true, badge: true, sound: true);
    return settings.authorizationStatus != AuthorizationStatus.denied;
  }

  @override
  Future<String?> token() => _messaging.getToken();

  @override
  Stream<String> get tokenRefreshes => _messaging.onTokenRefresh;
}

/// Registers this phone with RoadLink Core so it can send alerts while the app is closed.
///
/// Best effort by design: if Firebase is unavailable, permission is refused, or the network is down, the app
/// carries on and still gets everything over its live connection. Nothing in here may ever throw into the UI.
/// While the app is open the live connection delivers updates; the system shows pushed alerts only when it is
/// not (Core sends `notification` messages, which Android displays itself).
class PushService {
  PushService({required this.register, this.clear, PushSource? source}) : _source = source;

  /// Tell Core about a token (Core keeps one per account).
  final Future<void> Function(String token) register;

  /// Tell Core to stop pushing to this phone. Called on sign-out.
  final Future<void> Function()? clear;

  PushSource? _source;
  StreamSubscription<String>? _refresh;

  /// True once a token has been registered and refreshes are being followed.
  bool get active => _refresh != null;

  /// Ask permission, register the token, and keep it registered. Returns whether push is now set up.
  Future<bool> start() async {
    if (kIsWeb) return false; // browsers need a service worker and a VAPID key; the staff apps are Android
    try {
      final source = _source ??= FirebasePushSource();
      if (!await source.requestPermission()) return false;
      final token = await source.token();
      if (token == null || token.isEmpty) return false;
      await register(token);
      await _refresh?.cancel();
      _refresh = source.tokenRefreshes.listen((t) => unawaited(_registerQuietly(t)));
      return true;
    } catch (e) {
      debugPrint('Push alerts not set up: $e');
      return false;
    }
  }

  /// Stop following token changes and, unless the session is already gone ([tellServer] false), tell Core to
  /// stop pushing here so the next person to sign in on this phone does not receive this account's alerts.
  Future<void> stop({bool tellServer = true}) async {
    await _refresh?.cancel();
    _refresh = null;
    if (!tellServer || clear == null) return;
    try {
      await clear!();
    } catch (e) {
      debugPrint('Could not clear the push token: $e');
    }
  }

  Future<void> _registerQuietly(String token) async {
    try {
      await register(token);
    } catch (e) {
      debugPrint('Could not register the new push token: $e');
    }
  }
}
