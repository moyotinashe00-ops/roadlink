import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';


/// Every server error carries a stable [code] (e.g. BAD_STATE, JOB_IN_PROGRESS); branch on it, not on [message].
class ApiException implements Exception {
  final int status;
  final String code;
  final String message;
  ApiException(this.status, this.code, this.message);
  bool get isNetwork => status == 0;
  @override
  String toString() => message;
}

class LoginResult {
  final String token;
  final AppUser user;
  const LoginResult(this.token, this.user);
}

/// Client for RoadLink Core (see roadlink-core/docs/API.md).
class RoadLinkApi {
  RoadLinkApi({
    required this.baseUrl,
    required this.tokenProvider,
    this.onUnauthorized,
    http.Client? client,
  }) : _client = client ?? http.Client();

  final String baseUrl;
  final String? Function() tokenProvider;
  final void Function()? onUnauthorized;
  final http.Client _client;

  Future<dynamic> _send(String method, String path, {Object? body}) async {
    final token = tokenProvider();
    final headers = <String, String>{'Accept': 'application/json'};
    if (token != null) headers['Authorization'] = 'Bearer $token';
    if (body != null) headers['Content-Type'] = 'application/json';

    final uri = Uri.parse('$baseUrl/api/v1$path');
    http.Response res;
    try {
      final req = http.Request(method, uri)..headers.addAll(headers);
      if (body != null) req.body = jsonEncode(body);
      res = await http.Response.fromStream(await _client.send(req).timeout(const Duration(seconds: 15)));
    } on TimeoutException {
      throw ApiException(0, 'NETWORK', 'The server took too long to answer.');
    } catch (_) {
      throw ApiException(0, 'NETWORK', 'Cannot reach RoadLink. Check your connection.');
    }

    if (res.statusCode == 204 || res.body.isEmpty) {
      if (res.statusCode >= 400) throw ApiException(res.statusCode, 'ERROR', 'Request failed (${res.statusCode})');
      return null;
    }
    dynamic data;
    try {
      data = jsonDecode(res.body);
    } catch (_) {
      data = null;
    }
    if (res.statusCode >= 400) {
      // A 401 while holding a token = expired session or disabled account.
      if (res.statusCode == 401 && token != null) onUnauthorized?.call();
      final err = data is Map ? data['error'] : null;
      throw ApiException(
        res.statusCode,
        err is Map ? (err['code'] as String? ?? 'ERROR') : 'ERROR',
        err is Map ? (err['message'] as String? ?? 'Request failed (${res.statusCode})') : 'Request failed (${res.statusCode})',
      );
    }
    return data;
  }

  Map<String, dynamic> _map(dynamic d) => Map<String, dynamic>.from(d as Map);

  // ---- auth ---------------------------------------------------------------
  Future<LoginResult> login(String identifier, String password) async {
    final d = _map(await _send('POST', '/auth/login', body: {'identifier': identifier, 'password': password}));
    return LoginResult(d['token'] as String, AppUser.fromJson(_map(d['user'])));
  }

  Future<AppUser> me() async => AppUser.fromJson(_map(_map(await _send('GET', '/auth/me'))['user']));

  // ---- own resource ------------------------------------------------------
  String _resourcePath(FieldRole role) => role == FieldRole.police ? '/police-units/me' : '/ambulances/me';

  Future<MyResource> myResource(FieldRole role) async => MyResource.fromJson(_map(await _send('GET', _resourcePath(role))));

  Future<bool> setAvailable(FieldRole role, bool available) async {
    final d = _map(await _send('PATCH', '${_resourcePath(role)}/availability', body: {'is_available': available}));
    return d['is_available'] == true;
  }

  Future<void> sendLocation(FieldRole role, double lat, double lng) =>
      _send('PATCH', '${_resourcePath(role)}/location', body: {'lat': lat, 'lng': lng});

  // ---- incidents ----------------------------------------------------------
  Future<List<Incident>> listIncidents({String status = 'open'}) async {
    final d = _map(await _send('GET', '/incidents?status=$status&limit=100'));
    return (d['incidents'] as List).map((e) => Incident.fromJson(_map(e))).toList();
  }

  Future<List<TimelineEntry>> timeline(String id) async {
    final d = _map(await _send('GET', '/incidents/$id/timeline'));
    return (d['timeline'] as List).map((e) => TimelineEntry.fromJson(_map(e))).toList();
  }

  Future<Incident> _incident(String method, String path, {Object? body}) async =>
      Incident.fromJson(_map(await _send(method, path, body: body)));

  // ---- police -------------------------------------------------------------
  Future<Incident> policeAccept(String id) => _incident('POST', '/incidents/$id/police/accept');
  Future<Incident> policeOnScene(String id) => _incident('POST', '/incidents/$id/police/on-scene');
  Future<Incident> policeClear(String id) => _incident('POST', '/incidents/$id/police/clear');

  /// Returns the name of the unit the incident was handed to, if any.
  Future<String?> policeDecline(String id, String reason) async {
    final d = _map(await _send('POST', '/incidents/$id/police/decline', body: {'reason': reason}));
    return d['reassigned_to'] as String?;
  }

  Future<Incident> sceneUpdate(String id, {int? verifiedVictimCount, String? hazardNotes, Severity? severity}) =>
      _incident('PATCH', '/incidents/$id/scene', body: {
        if (verifiedVictimCount != null) 'verified_victim_count': verifiedVictimCount,
        if (hazardNotes != null && hazardNotes.isNotEmpty) 'hazard_notes': hazardNotes,
        if (severity != null) 'severity': severity.apiValue,
      });

  Future<Incident> caseReference(String id, String reference) =>
      _incident('PUT', '/incidents/$id/case-reference', body: {'reference_number': reference});

  // ---- ambulance ----------------------------------------------------------
  /// status: enRoute | onScene | transporting | arrived
  Future<Incident> ambulanceStatus(String id, String status) =>
      _incident('POST', '/incidents/$id/ambulance/status', body: {'status': status});

  /// Record the patient's vitals. Every value is optional, but at least one is required and blood
  /// pressure needs both numbers. [consciousness]: alert | voice | pain | unresponsive.
  Future<Incident> recordVitals(
    String id, {
    int? pulseBpm,
    int? systolicBp,
    int? diastolicBp,
    int? spo2Percent,
    String? consciousness,
  }) =>
      _incident('POST', '/incidents/$id/ambulance/vitals', body: {
        if (pulseBpm != null) 'pulse_bpm': pulseBpm,
        if (systolicBp != null) 'systolic_bp': systolicBp,
        if (diastolicBp != null) 'diastolic_bp': diastolicBp,
        if (spo2Percent != null) 'spo2_percent': spo2Percent,
        if (consciousness != null) 'consciousness': consciousness,
      });

  void close() => _client.close();
}
