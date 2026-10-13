import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../models/incident.dart';
import '../theme/app_theme.dart';

/// Renders the incident lifecycle from SRS §5.3 as a vertical timeline,
/// highlighting every stage up to and including the current one.
class StatusTimeline extends StatelessWidget {
  final IncidentStatus current;
  const StatusTimeline({super.key, required this.current});

  static const List<IncidentStatus> _stages = [
    IncidentStatus.reported,
    IncidentStatus.policeNotified,
    IncidentStatus.policeOnScene,
    IncidentStatus.ambulanceAssigned,
    IncidentStatus.ambulanceEnRoute,
    IncidentStatus.ambulanceOnScene,
    IncidentStatus.transporting,
    IncidentStatus.hospitalNotified,
    IncidentStatus.admitted,
  ];

  @override
  Widget build(BuildContext context) {
    final currentIndex = _stages.indexOf(current);
    return Column(
      children: List.generate(_stages.length, (i) {
        final stage = _stages[i];
        final done = i <= currentIndex;
        final isLast = i == _stages.length - 1;
        return IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Column(
                children: [
                  Container(
                    width: 16,
                    height: 16,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: done ? AppColors.amber : Colors.transparent,
                      border: Border.all(color: done ? AppColors.amber : AppColors.border, width: 2),
                    ),
                  ),
                  if (!isLast)
                    Expanded(
                      child: Container(
                        width: 2,
                        color: done ? AppColors.amber.withOpacity(0.5) : AppColors.border,
                      ),
                    ),
                ],
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 24),
                  child: Text(
                    stage.label,
                    style: GoogleFonts.ibmPlexSans(
                      fontSize: 15,
                      fontWeight: done ? FontWeight.w600 : FontWeight.w400,
                      color: done ? AppColors.textPrimary : AppColors.textMuted,
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      }),
    );
  }
}
