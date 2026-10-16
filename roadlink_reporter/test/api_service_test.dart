import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:roadlink_reporter/models/incident.dart';
import 'package:roadlink_reporter/services/api_service.dart';

Incident _draft() => Incident(
      latitude: -17.8292,
      longitude: 31.0522,
      victimCount: 2,
      severity: Severity.serious,
      description: 'Two cars collided',
      status: IncidentStatus.reported,
      createdAt: DateTime.utc(2026, 10, 16),
    );

// Same shape RoadLink Core returns to an anonymous reporter.
Map<String, dynamic> _publicView() => {
      'id': '6f1c2d3e-0000-4000-8000-000000000001',
      'reference_number': 'RL-2600001',
      'lat': -17.8292,
      'lng': 31.0522,
      'location_accuracy': 'gps',
      'victim_count': 2,
      'severity': 'serious',
      'description': 'Two cars collided',
      'status': 'policeNotified',
      'created_at': '2026-10-16T09:00:00.000Z',
      'merged': false,
    };

http.Response _json(Object body, int status) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

void main() {
  test('submitIncident posts the draft to /api/v1/incidents and parses the reply', () async {
    http.Request? sent;
    final api = ApiService(
      baseUrl: 'http://core.test/',
      client: MockClient((request) async {
        sent = request;
        return _json(_publicView(), 201);
      }),
    );

    final saved = await api.submitIncident(_draft());

    expect(sent!.method, 'POST');
    expect(sent!.url.toString(), 'http://core.test/api/v1/incidents');
    final body = jsonDecode(sent!.body) as Map<String, dynamic>;
    expect(body['severity'], 'serious');
    expect(body['victim_count'], 2);
    expect(body['lat'], -17.8292);
    expect(saved.referenceNumber, 'RL-2600001');
    expect(saved.status, IncidentStatus.policeNotified);
  });

  test('a rate-limit rejection keeps the message Core sends', () async {
    final api = ApiService(
      baseUrl: 'http://core.test',
      client: MockClient((request) async => _json({
            'error': {
              'code': 'RATE_LIMITED',
              'message': 'Too many reports from this connection. Please call the dispatch centre.',
            },
          }, 429)),
    );

    expect(
      () => api.submitIncident(_draft()),
      throwsA(
        isA<ApiException>().having(
          (e) => e.message,
          'message',
          allOf(contains('429'), contains('call the dispatch centre')),
        ),
      ),
    );
  });

  test('a non-JSON error body falls back to the status code', () async {
    final api = ApiService(
      baseUrl: 'http://core.test',
      client: MockClient((request) async => http.Response('Bad Gateway', 502)),
    );

    expect(
      () => api.submitIncident(_draft()),
      throwsA(
        isA<ApiException>().having((e) => e.message, 'message', contains('502')),
      ),
    );
  });

  test('every status Core can send is understood by the app', () {
    const fromCore = [
      'reported', 'policeNotified', 'policeOnScene', 'ambulanceAssigned', 'ambulanceEnRoute',
      'ambulanceOnScene', 'transporting', 'hospitalNotified', 'admitted', 'closed',
    ];
    for (final status in fromCore) {
      expect(IncidentStatusX.fromApi(status).name, status);
    }
  });
}
