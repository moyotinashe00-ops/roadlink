import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:roadlink_shared/roadlink_shared.dart';

import 'firebase_options.dart';
import 'screens/ambulance_home.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(AmbulanceApp(pushEnabled: await _initFirebase()));
}

/// Push alerts need Firebase. If it cannot start (no Google Play services, a bad config) the app still works
/// through its live connection; it just cannot be alerted while it is closed.
Future<bool> _initFirebase() async {
  try {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    return true;
  } catch (e) {
    debugPrint('Firebase unavailable, push alerts are off: $e');
    return false;
  }
}

class AmbulanceApp extends StatelessWidget {
  const AmbulanceApp({super.key, this.pushEnabled = false});

  /// True once Firebase has started; the app then registers this phone for push alerts after sign-in.
  final bool pushEnabled;

  @override
  Widget build(BuildContext context) {
    return FieldAppShell(
      role: FieldRole.ambulance,
      title: 'Ambulance',
      subtitle: 'Crew console',
      accent: const Color(0xFFFF4B1F),
      icon: Icons.emergency_rounded,
      enablePush: pushEnabled,
      home: (controller) => AmbulanceHome(controller: controller),
    );
  }
}
