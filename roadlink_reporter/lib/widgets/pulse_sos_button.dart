import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../theme/app_theme.dart';

/// The single primary action of RoadLink Reporter (SRS CIT-01): one
/// large, unmissable control that reports an accident. Three
/// continuously expanding rings behind it read as a radar/siren pulse —
/// the app's signature visual, and a deliberate cue that this button
/// is "always listening," not a static icon.
class PulseSosButton extends StatefulWidget {
  final VoidCallback onPressed;
  final String label;

  const PulseSosButton({
    super.key,
    required this.onPressed,
    this.label = 'REPORT\nACCIDENT',
  });

  @override
  State<PulseSosButton> createState() => _PulseSosButtonState();
}

class _PulseSosButtonState extends State<PulseSosButton> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(seconds: 2))..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: widget.onPressed,
      child: SizedBox(
        width: 260,
        height: 260,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            final t = _controller.value;
            return Stack(
              alignment: Alignment.center,
              children: [
                _ring(t),
                _ring((t + 0.33) % 1.0),
                _ring((t + 0.66) % 1.0),
                _core(),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _core() {
    return Container(
      width: 160,
      height: 160,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.alert, Color(0xFFB2101F)],
        ),
        boxShadow: [
          BoxShadow(color: AppColors.alert.withValues(alpha: 0.55), blurRadius: 30, spreadRadius: 4),
        ],
      ),
      child: Text(
        widget.label,
        textAlign: TextAlign.center,
        style: GoogleFonts.rajdhani(
          fontSize: 22,
          fontWeight: FontWeight.w800,
          letterSpacing: 1.4,
          height: 1.15,
          color: Colors.white,
        ),
      ),
    );
  }

  Widget _ring(double t) {
    final size = 160 + (100 * t);
    final opacity = (1 - t).clamp(0.0, 1.0) * 0.5;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.alert.withValues(alpha: opacity), width: 2),
      ),
    );
  }
}
