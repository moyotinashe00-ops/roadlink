import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:roadlink_reporter/models/incident.dart';
import 'package:roadlink_reporter/widgets/status_timeline.dart';

Map<String, dynamic> _json({
  required String status,
  String? outcome,
  List<Map<String, String>> milestones = const [],
}) =>
    {
      'id': 'inc-1',
      'reference_number': 'RL-2600001',
      'lat': -17.83,
      'lng': 31.05,
      'victim_count': 1,
      'severity': 'serious',
      'description': '',
      'status': status,
      'created_at': '2026-10-31T08:00:00.000Z',
      if (outcome != null) 'outcome': outcome,
      'milestones': milestones,
    };

Widget _host(Widget child) => MaterialApp(
      home: Scaffold(body: SingleChildScrollView(child: child)),
    );

void main() {
  group('what the citizen is told (review points 3 and 4)', () {
    testWidgets('shows only what happened, in the order it happened', (tester) async {
      // Dispatch notified the hospital BEFORE the crew set off: the old fixed list put it after "transporting".
      final incident = Incident.fromJson(_json(
        status: 'hospitalNotified',
        milestones: [
          {'status': 'reported', 'at': '2026-10-31T08:00:00.000Z'},
          {'status': 'policeNotified', 'at': '2026-10-31T08:00:01.000Z'},
          {'status': 'ambulanceAssigned', 'at': '2026-10-31T08:02:00.000Z'},
          {'status': 'hospitalNotified', 'at': '2026-10-31T08:02:30.000Z'},
          {'status': 'ambulanceEnRoute', 'at': '2026-10-31T08:03:00.000Z'},
        ],
      ));
      await tester.pumpWidget(_host(StatusTimeline(
        current: incident.status,
        milestones: incident.milestones,
        outcome: incident.outcome,
      )));

      expect(find.text('Receiving hospital notified'), findsOneWidget);
      expect(find.text('Ambulance en route'), findsOneWidget);
      expect(
        tester.getTopLeft(find.text('Receiving hospital notified')).dy,
        lessThan(tester.getTopLeft(find.text('Ambulance en route')).dy),
        reason: 'hospital was notified first, so it is listed first',
      );
      // stages that have not happened are not listed as if they might have
      expect(find.text('Patient admitted'), findsNothing);
      expect(find.text('Transporting patient'), findsNothing);
    });

    testWidgets('a closed incident with no transport never claims a patient was admitted', (tester) async {
      final incident = Incident.fromJson(_json(
        status: 'closed',
        outcome: 'no_transport',
        milestones: [
          {'status': 'reported', 'at': '2026-10-31T08:00:00.000Z'},
          {'status': 'ambulanceAssigned', 'at': '2026-10-31T08:02:00.000Z'},
          {'status': 'closed', 'at': '2026-10-31T08:10:00.000Z'},
        ],
      ));
      await tester.pumpWidget(_host(StatusTimeline(
        current: incident.status,
        milestones: incident.milestones,
        outcome: incident.outcome,
      )));

      expect(find.text('Closed: no transport needed'), findsOneWidget);
      expect(find.text('Patient admitted'), findsNothing);
      expect(find.text('Receiving hospital notified'), findsNothing);
      expect(incident.statusLabel, 'Closed: no transport needed');
      expect(incident.closingMessage, contains('no one needed to be taken to hospital'));
    });

    testWidgets('an older server without milestones still shows a closed incident honestly', (tester) async {
      final incident = Incident.fromJson(_json(status: 'closed'));
      await tester.pumpWidget(_host(StatusTimeline(current: incident.status)));

      expect(find.text('Closed'), findsOneWidget);
      expect(find.text('Patient admitted'), findsNothing);
    });

    test('every way an incident can end is described as itself', () {
      expect(Incident.fromJson(_json(status: 'closed', outcome: 'completed')).statusLabel, 'Closed: patient admitted');
      expect(Incident.fromJson(_json(status: 'closed', outcome: 'false_alarm')).statusLabel, 'Closed: false alarm');
      expect(Incident.fromJson(_json(status: 'closed', outcome: 'cancelled')).statusLabel, 'Closed: report cancelled');
      expect(Incident.fromJson(_json(status: 'closed')).statusLabel, 'Closed');
      // while open there is no closing message, and an admitted patient is still just "admitted"
      expect(Incident.fromJson(_json(status: 'ambulanceEnRoute')).closingMessage, isNull);
      expect(Incident.fromJson(_json(status: 'admitted')).closingMessage, startsWith('Patient admitted'));
    });

    test('tolerates milestones this app version does not know, bad times and junk', () {
      final incident = Incident.fromJson(_json(status: 'reported', milestones: [
        {'status': 'teleported', 'at': '2026-10-31T08:00:00.000Z'},
        {'status': 'reported', 'at': 'not-a-date'},
      ]));
      expect(incident.milestones.length, 1);
      expect(incident.milestones.first.status, IncidentStatus.reported);
      expect(incident.milestones.first.at, isNull);
    });
  });

  test('one word for the worst severity (review point 2)', () {
    expect(Severity.fatal.label, 'Fatal');
    expect(Severity.values.map((s) => s.label), isNot(contains('Fatalities')));
  });
}
