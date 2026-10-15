import 'package:flutter_test/flutter_test.dart';
import 'package:roadlink_shared/roadlink_shared.dart';

import 'package:roadlink_ambulance/main.dart';

void main() {
  testWidgets('configures the ambulance app shell', (WidgetTester tester) async {
    await tester.pumpWidget(const AmbulanceApp());

    final shell = tester.widget<FieldAppShell>(find.byType(FieldAppShell));
    expect(shell.role, FieldRole.ambulance);
    expect(shell.title, 'Ambulance');
    expect(shell.subtitle, 'Crew console');
  });
}
