import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'models.dart';

class SessionData {
  final String token;
  final AppUser user;
  const SessionData(this.token, this.user);
}

/// Keeps the sign-in token in the platform keystore (Android Keystore / iOS Keychain),
/// not in plain preferences, because field devices get lost.
class SessionStore {
  SessionStore({FlutterSecureStorage? storage}) : _s = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _s;
  static const _key = 'roadlink.session';

  Future<void> save(SessionData d) =>
      _s.write(key: _key, value: jsonEncode({'token': d.token, 'user': d.user.toJson()}));

  Future<SessionData?> load() async {
    try {
      final raw = await _s.read(key: _key);
      if (raw == null) return null;
      final m = jsonDecode(raw) as Map<String, dynamic>;
      return SessionData(m['token'] as String, AppUser.fromJson(Map<String, dynamic>.from(m['user'] as Map)));
    } catch (_) {
      return null;
    }
  }

  Future<void> clear() => _s.delete(key: _key);
}
