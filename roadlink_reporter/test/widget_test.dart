import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:roadlink_reporter/main.dart';

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const RoadLinkReporterApp());
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
