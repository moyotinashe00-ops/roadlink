import 'package:flutter/material.dart';
import 'package:roadlink_shared/roadlink_shared.dart';

import 'screens/police_home.dart';

void main() {
  runApp(const PoliceApp());
}

class PoliceApp extends StatelessWidget {
  const PoliceApp({super.key});

  @override
  Widget build(BuildContext context) {
    return FieldAppShell(
      role: FieldRole.police,
      title: 'Police',
      subtitle: 'Traffic unit console',
      accent: const Color(0xFF3AA0FF),
      icon: Icons.local_police_rounded,
      home: (controller) => PoliceHome(controller: controller),
    );
  }
}
