import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../models/incident.dart';
import '../theme/app_theme.dart';

/// Implements CIT-04: a short, predefined severity list the reporter
/// taps instead of typing, since an accurate estimate under stress
/// matters more than a precise medical classification.
class SeveritySelector extends StatelessWidget {
  final Severity value;
  final ValueChanged<Severity> onChanged;

  const SeveritySelector({super.key, required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: Severity.values.map((s) {
        final selected = s == value;
        return Expanded(
          child: GestureDetector(
            onTap: () => onChanged(s),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              margin: const EdgeInsets.symmetric(horizontal: 4),
              padding: const EdgeInsets.symmetric(vertical: 14),
              decoration: BoxDecoration(
                color: selected ? s.color.withValues(alpha: 0.18) : AppColors.surface,
                border: Border.all(color: selected ? s.color : AppColors.border, width: selected ? 2 : 1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(
                children: [
                  Icon(s.icon, color: selected ? s.color : AppColors.textMuted, size: 22),
                  const SizedBox(height: 6),
                  Text(
                    s.label,
                    textAlign: TextAlign.center,
                    style: GoogleFonts.ibmPlexSans(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: selected ? s.color : AppColors.textMuted,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}
