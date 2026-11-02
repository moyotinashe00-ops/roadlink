import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../models/incident.dart';
import '../theme/app_theme.dart';

/// The incident's progress as a vertical timeline.
///
/// Built from the stages that REALLY happened, in the order they happened ([milestones], from the server's
/// timeline), each with its time. It no longer assumes a fixed order with everything before the current stage
/// "done": that showed "Patient admitted" on an incident that closed with no transport, and put "hospital
/// notified" after "transporting" even when dispatch had notified the hospital earlier.
///
/// An older server that does not send milestones gets the previous fixed-order behaviour, except that a closed
/// incident is shown as closed and never as admitted.
class StatusTimeline extends StatelessWidget {
  final IncidentStatus current;
  final List<IncidentMilestone> milestones;
  final String? outcome;

  const StatusTimeline({
    super.key,
    required this.current,
    this.milestones = const [],
    this.outcome,
  });

  static const List<IncidentStatus> _fixedOrder = [
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

  String _label(IncidentStatus s) =>
      s == IncidentStatus.closed ? IncidentWordingX.closedLabel(outcome) : s.label;

  String _clock(DateTime t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  List<_Row> _rows() {
    if (milestones.isNotEmpty) {
      return [
        for (var i = 0; i < milestones.length; i++)
          _Row(
            label: _label(milestones[i].status),
            time: milestones[i].at == null ? null : _clock(milestones[i].at!),
            done: true,
            latest: i == milestones.length - 1,
          ),
      ];
    }
    // Older server: no milestones. A closed incident is just "closed" (we cannot know what happened before).
    if (current == IncidentStatus.closed) {
      return [_Row(label: _label(IncidentStatus.closed), done: true, latest: true)];
    }
    final currentIndex = _fixedOrder.indexOf(current);
    return [
      for (var i = 0; i < _fixedOrder.length; i++)
        _Row(label: _fixedOrder[i].label, done: i <= currentIndex, latest: i == currentIndex),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows();
    return Column(
      children: List.generate(rows.length, (i) {
        final row = rows[i];
        final isLast = i == rows.length - 1;
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
                      color: row.done ? AppColors.amber : Colors.transparent,
                      border: Border.all(color: row.done ? AppColors.amber : AppColors.border, width: 2),
                    ),
                  ),
                  if (!isLast)
                    Expanded(
                      child: Container(
                        width: 2,
                        color: row.done ? AppColors.amber.withValues(alpha: 0.5) : AppColors.border,
                      ),
                    ),
                ],
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 24),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          row.label,
                          style: GoogleFonts.ibmPlexSans(
                            fontSize: 15,
                            fontWeight: row.done ? FontWeight.w600 : FontWeight.w400,
                            color: row.done ? AppColors.textPrimary : AppColors.textMuted,
                          ),
                        ),
                      ),
                      if (row.time != null)
                        Text(
                          row.time!,
                          style: GoogleFonts.ibmPlexSans(fontSize: 13, color: AppColors.textMuted),
                        ),
                    ],
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

class _Row {
  final String label;
  final String? time;
  final bool done;
  final bool latest;
  const _Row({required this.label, this.time, required this.done, required this.latest});
}
