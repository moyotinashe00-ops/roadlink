import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

import '../models/incident.dart';

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}

/// Client for the RoadLink Core backend described in the SRS (§3, §4.7,
/// §6.4): a REST API for create/read actions, plus a live channel for
/// status updates. RoadLink Core is out of scope for this repository —
/// point [baseUrl] at your deployed backend and set [mockMode] to false
/// once it is running.
///
/// With [mockMode] left on (the default), the app is fully demoable
/// without a backend: submissions succeed locally and the status screen
/// plays back a realistic Reported → Admitted sequence.
class ApiService {
  ApiService({
    this.baseUrl = 'https://api.roadlink.example.zw/v1',
    this.mockMode = true,
  });

  final String baseUrl;
  final bool mockMode;

  /// Implements CIT-07: returns a saved incident carrying a confirmation
  /// reference number.
  Future<Incident> submitIncident(Incident draft) async {
    if (mockMode) {
      await Future.delayed(const Duration(milliseconds: 900));
      final id = 'MOCK-${DateTime.now().millisecondsSinceEpoch}';
      final ref = 'RL-${1000 + Random().nextInt(8999)}';
      return draft.copyWith(id: id, referenceNumber: ref, status: IncidentStatus.reported);
    }

    final res = await http.post(
      Uri.parse('$baseUrl/incidents'),
      headers: const {'Content-Type': 'application/json'},
      body: jsonEncode(draft.toJson()),
    );

    if (res.statusCode == 200 || res.statusCode == 201) {
      return Incident.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
    }
    throw ApiException('Server returned ${res.statusCode}.');
  }

  /// Implements CIT-09 / NFR §7.3: live status for the citizen's own
  /// report. In real mode this polls GET /incidents/{id} — the mobile
  /// fallback described in the SRS for when the always-on WebSocket
  /// channel is unreachable from a client. Poll, not push, is used here
  /// deliberately: it keeps this app simple and works even on a flaky
  /// connection.
  Stream<Incident> watchIncident(Incident incident) {
    final controller = StreamController<Incident>();
    if (mockMode) {
      _playMockSequence(incident, controller);
    } else {
      _pollStatus(incident, controller);
    }
    return controller.stream;
  }

  Future<void> _playMockSequence(Incident incident, StreamController<Incident> controller) async {
    const sequence = [
      IncidentStatus.reported,
      IncidentStatus.policeNotified,
      IncidentStatus.policeOnScene,
      IncidentStatus.ambulanceAssigned,
      IncidentStatus.ambulanceEnRoute,
      IncidentStatus.ambulanceOnScene,
      IncidentStatus.transporting,
      IncidentStatus.hospitalNotified,
      IncidentStatus.admitted,
    ];
    for (final status in sequence) {
      if (controller.isClosed) return;
      controller.add(incident.copyWith(status: status));
      await Future.delayed(const Duration(seconds: 4));
    }
    await controller.close();
  }

  void _pollStatus(Incident incident, StreamController<Incident> controller) {
    final timer = Timer.periodic(const Duration(seconds: 5), (_) async {
      try {
        final res = await http.get(Uri.parse('$baseUrl/incidents/${incident.id}'));
        if (res.statusCode == 200) {
          final updated = Incident.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
          controller.add(updated);
          if (updated.status == IncidentStatus.admitted || updated.status == IncidentStatus.closed) {
            await controller.close();
          }
        }
      } catch (_) {
        // Transient network error — keep polling rather than surfacing
        // a failure for a background status check.
      }
    });
    controller.onCancel = timer.cancel;
  }
}
