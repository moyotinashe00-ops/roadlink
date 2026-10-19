import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:roadlink_reporter/models/incident.dart';
import 'package:roadlink_reporter/services/api_service.dart';

Incident _draft({Uint8List? photo}) => Incident(
      latitude: -17.8292,
      longitude: 31.0522,
      victimCount: 2,
      severity: Severity.serious,
      description: 'Two cars collided',
      photoBytes: photo,
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

  test('a photo is uploaded from bytes with its real image type', () async {
    final requests = <http.Request>[];
    final api = ApiService(
      baseUrl: 'http://core.test',
      client: MockClient((request) async {
        requests.add(request);
        if (request.url.path.endsWith('/photo')) return _json({'ok': true}, 201);
        return _json(_publicView(), 201);
      }),
    );
    // The first bytes of a PNG file. The filename is deliberately not used to decide the type.
    final png = Uint8List.fromList([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);

    await api.submitIncident(_draft(photo: png));

    expect(requests, hasLength(2));
    final upload = requests[1];
    expect(upload.url.path, '/api/v1/incidents/6f1c2d3e-0000-4000-8000-000000000001/photo');
    expect(upload.headers['content-type'], startsWith('multipart/form-data'));
    expect(upload.body, contains('name="photo"'));
    expect(upload.body, contains('image/png'));
  });

  test('a report without a photo makes no upload request', () async {
    var calls = 0;
    final api = ApiService(
      baseUrl: 'http://core.test',
      client: MockClient((request) async {
        calls += 1;
        return _json(_publicView(), 201);
      }),
    );

    await api.submitIncident(_draft());

    expect(calls, 1);
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
