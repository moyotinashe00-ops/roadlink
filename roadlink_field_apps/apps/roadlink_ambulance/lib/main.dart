import 'package:flutter/material.dart';
import 'package:roadlink_shared/roadlink_shared.dart';

import 'screens/ambulance_home.dart';

void main() {
  runApp(const AmbulanceApp());
}

class AmbulanceApp extends StatelessWidget {
  const AmbulanceApp({super.key});

  @override
  Widget build(BuildContext context) {
    return FieldAppShell(
      role: FieldRole.ambulance,
      title: 'Ambulance',
      subtitle: 'Crew console',
      accent: const Color(0xFFFF2E43),
      icon: Icons.emergency_rounded,
      home: (controller) => AmbulanceHome(controller: controller),
    );
  }
}
