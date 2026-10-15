import 'package:flutter_test/flutter_test.dart';
import 'package:roadlink_shared/roadlink_shared.dart';

import 'package:roadlink_police/main.dart';

void main() {
  testWidgets('configures the police app shell', (WidgetTester tester) async {
    await tester.pumpWidget(const PoliceApp());

    final shell = tester.widget<FieldAppShell>(find.byType(FieldAppShell));
    expect(shell.role, FieldRole.police);
    expect(shell.title, 'Police');
    expect(shell.subtitle, 'Traffic unit console');
  });
}
