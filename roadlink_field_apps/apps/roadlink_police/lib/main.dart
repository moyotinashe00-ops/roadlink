import 'package:flutter/material.dart';
import 'package:roadlink_shared/roadlink_shared.dart';

import 'screens/police_home.dart';

void main() {
  runApp(FieldAppShell(
    role: FieldRole.police,
    title: 'Police',
    subtitle: 'Traffic unit console',
    accent: const Color(0xFF3AA0FF), // patrol blue
    icon: Icons.local_police_rounded,
    home: (controller) => PoliceHome(controller: controller),
  ));
}
