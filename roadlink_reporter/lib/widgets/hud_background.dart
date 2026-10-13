import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Wraps a screen in the "Emergency HUD" backdrop: two soft glow blobs
/// (alert-red top right, amber bottom left) plus a faint scanline
/// texture, instead of a flat single-colour background.
class HudBackground extends StatelessWidget {
  final Widget child;
  const HudBackground({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        const Positioned.fill(child: ColoredBox(color: AppColors.bg)),
        Positioned(top: -80, right: -60, child: _glowBlob(AppColors.alert.withOpacity(0.16), 220)),
        Positioned(bottom: -110, left: -80, child: _glowBlob(AppColors.amber.withOpacity(0.10), 260)),
        Positioned.fill(child: CustomPaint(painter: _ScanlinePainter())),
        child,
      ],
    );
  }

  static Widget _glowBlob(Color color, double size) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(colors: [color, color.withOpacity(0)]),
        ),
      ),
    );
  }
}

class _ScanlinePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withOpacity(0.025)
      ..strokeWidth = 1;
    for (double y = 0; y < size.height; y += 4) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
