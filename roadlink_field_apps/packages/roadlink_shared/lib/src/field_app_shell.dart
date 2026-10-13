import 'package:flutter/material.dart';

import 'field_controller.dart';
import 'login_screen.dart';
import 'models.dart';
import 'theme.dart';
import 'widgets.dart';

/// Wraps an app in the shared lifecycle: restore session → login gate → the app's own home screen.
/// Both field apps are just this shell plus their role-specific screens.
class FieldAppShell extends StatefulWidget {
  final FieldRole role;
  final String title;
  final String subtitle;
  final Color accent;
  final IconData icon;
  final Widget Function(FieldController controller) home;

  /// Set at build time:  flutter run --dart-define=ROADLINK_API=http://192.168.1.10:3000
  final String baseUrl;

  const FieldAppShell({
    super.key,
    required this.role,
    required this.title,
    required this.subtitle,
    required this.accent,
    required this.icon,
    required this.home,
    this.baseUrl = const String.fromEnvironment('ROADLINK_API', defaultValue: 'http://10.0.2.2:3000'),
  });

  @override
  State<FieldAppShell> createState() => _FieldAppShellState();
}

class _FieldAppShellState extends State<FieldAppShell> {
  late final FieldController _c;
  final _navKey = GlobalKey<NavigatorState>();
  bool _wasSignedIn = false;

  @override
  void initState() {
    super.initState();
    _c = FieldController(role: widget.role, baseUrl: widget.baseUrl);
    _c.addListener(_onChange);
    _c.restore();
  }

  // If the session ends (expired, disabled) while a screen is open, drop back to the gate.
  void _onChange() {
    if (_wasSignedIn && !_c.signedIn) _navKey.currentState?.popUntil((r) => r.isFirst);
    _wasSignedIn = _c.signedIn;
  }

  @override
  void dispose() {
    _c.removeListener(_onChange);
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: widget.title,
      debugShowCheckedModeBanner: false,
      navigatorKey: _navKey,
      theme: AppTheme.dark(accent: widget.accent),
      home: ListenableBuilder(
        listenable: _c,
        builder: (context, _) {
          if (_c.restoring) {
            return const Scaffold(body: HudBackground(child: Center(child: CircularProgressIndicator())));
          }
          if (_c.signedIn) return widget.home(_c);
          return LoginScreen(controller: _c, title: widget.title, subtitle: widget.subtitle, icon: widget.icon);
        },
      ),
    );
  }
}
