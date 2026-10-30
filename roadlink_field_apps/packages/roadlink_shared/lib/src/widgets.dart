import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api_client.dart';
import 'field_controller.dart';
import 'models.dart';
import 'theme.dart';

/// Runs an action and shows the server's message in a snackbar if it is refused. Returns true on success.
Future<bool> runGuarded(BuildContext context, Future<void> Function() action) async {
  try {
    await action();
    return true;
  } on ApiException catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
    return false;
  }
}

String fmtClock(DateTime? t) =>
    t == null ? '—' : '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

/// Dark HUD backdrop: two glow blobs + scanlines, never a flat colour.
class HudBackground extends StatelessWidget {
  final Widget child;
  const HudBackground({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    return Stack(
      children: [
        const Positioned.fill(child: ColoredBox(color: AppColors.bg)),
        Positioned(top: -90, right: -70, child: _blob(accent.withValues(alpha: 0.18), 240)),
        Positioned(bottom: -120, left: -90, child: _blob(AppColors.amber.withValues(alpha: 0.09), 280)),
        Positioned.fill(child: CustomPaint(painter: _Scanlines())),
        child,
      ],
    );
  }

  static Widget _blob(Color c, double size) => IgnorePointer(
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(shape: BoxShape.circle, gradient: RadialGradient(colors: [c, c.withValues(alpha: 0)])),
        ),
      );
}

class _Scanlines extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = Colors.white.withValues(alpha: 0.025)
      ..strokeWidth = 1;
    for (double y = 0; y < size.height; y += 4) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), p);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter old) => false;
}

class SeverityBadge extends StatelessWidget {
  final Severity severity;
  const SeverityBadge(this.severity, {super.key});

  @override
  Widget build(BuildContext context) {
    final c = severity.color;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.16),
        border: Border.all(color: c),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        severity.label.toUpperCase(),
        style: RoadLinkFonts.display(fontSize: 13, fontWeight: FontWeight.w800, letterSpacing: 1.4, color: c),
      ),
    );
  }
}

/// Shows connection health. While not live the app polls every 15 s, so data is late, never lost.
class LiveBanner extends StatelessWidget {
  final FieldController controller;
  const LiveBanner({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final gpsProblem = c.location?.problem.value;
    final msgs = <(String, Color)>[];
    if (c.live == LiveStatus.offline) msgs.add(('Connection lost — refreshing every 15 s', AppColors.amber));
    if (c.lastError != null && c.live != LiveStatus.offline) msgs.add((c.lastError!, AppColors.alert));
    if (gpsProblem != null) msgs.add((gpsProblem, AppColors.amber));
    if (msgs.isEmpty) return const SizedBox.shrink();
    return Column(
      children: msgs
          .map((m) => Container(
                width: double.infinity,
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                decoration: BoxDecoration(
                  color: m.$2.withValues(alpha: 0.12),
                  border: Border.all(color: m.$2.withValues(alpha: 0.6)),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(m.$1, style: GoogleFonts.ibmPlexSans(fontSize: 13, color: m.$2)),
              ))
          .toList(),
    );
  }
}

/// On-duty switch. [busy] disables it while a request is in flight.
class DutyToggle extends StatelessWidget {
  final String label;
  final bool available;
  final bool busy;
  final ValueChanged<bool> onChanged;
  const DutyToggle({super.key, required this.label, required this.available, required this.busy, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final color = available ? AppColors.safe : AppColors.textMuted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: available ? AppColors.safe.withValues(alpha: 0.6) : AppColors.border),
      ),
      child: Row(
        children: [
          Container(width: 10, height: 10, decoration: BoxDecoration(shape: BoxShape.circle, color: color)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: RoadLinkFonts.display(fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
                Text(available ? 'Available for dispatch' : 'Not available — dispatch will skip you',
                    style: GoogleFonts.ibmPlexSans(fontSize: 12, color: color)),
              ],
            ),
          ),
          Switch(value: available, onChanged: busy ? null : onChanged, activeThumbColor: AppColors.safe),
        ],
      ),
    );
  }
}

class FactTile extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  const FactTile(this.label, this.value, {super.key, this.valueColor});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label.toUpperCase(), style: GoogleFonts.ibmPlexSans(fontSize: 10, letterSpacing: 1.6, color: AppColors.textMuted)),
        const SizedBox(height: 2),
        Text(value, style: RoadLinkFonts.display(fontSize: 20, fontWeight: FontWeight.w700, color: valueColor ?? AppColors.textPrimary)),
      ],
    );
  }
}

/// Press and HOLD to confirm. Used for the ambulance status steps, which cannot be undone and are
/// pressed on a moving vehicle: a hold survives a bump or a pocket-press that a tap would not.
class HoldToConfirmButton extends StatefulWidget {
  final String label;
  final VoidCallback? onConfirmed; // null disables the button
  final Color? color;
  final Duration hold;
  const HoldToConfirmButton({super.key, required this.label, required this.onConfirmed, this.color, this.hold = const Duration(milliseconds: 800)});

  @override
  State<HoldToConfirmButton> createState() => _HoldToConfirmButtonState();
}

class _HoldToConfirmButtonState extends State<HoldToConfirmButton> with SingleTickerProviderStateMixin {
  late final AnimationController _c;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(vsync: this, duration: widget.hold)
      ..addStatusListener((s) {
        if (s == AnimationStatus.completed) {
          widget.onConfirmed?.call();
          _c.value = 0;
        }
      });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onConfirmed != null;
    final color = widget.color ?? Theme.of(context).colorScheme.primary;
    return Semantics(
      button: true,
      enabled: enabled,
      label: '${widget.label}. Press and hold to confirm.',
      child: GestureDetector(
        onTapDown: enabled ? (_) => _c.forward() : null,
        onTapUp: enabled ? (_) => _c.reverse() : null,
        onTapCancel: enabled ? () => _c.reverse() : null,
        child: AnimatedBuilder(
          animation: _c,
          builder: (context, _) => Container(
            height: 76,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: enabled ? color : AppColors.border, width: 2),
              color: AppColors.surface,
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: FractionallySizedBox(widthFactor: _c.value, child: Container(color: color.withValues(alpha: 0.55))),
                  ),
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(widget.label,
                          textAlign: TextAlign.center,
                          style: RoadLinkFonts.display(
                              fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: 1.2, color: enabled ? Colors.white : AppColors.textMuted)),
                      if (enabled)
                        Text('HOLD TO CONFIRM', style: GoogleFonts.ibmPlexSans(fontSize: 10, letterSpacing: 2, color: AppColors.textMuted)),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Opens the phone's maps app with turn-by-turn directions (no map API key needed).
Future<void> openNavigation(double lat, double lng) async {
  final uri = Uri.parse('https://www.google.com/maps/dir/?api=1&destination=$lat,$lng&travelmode=driving');
  await launchUrl(uri, mode: LaunchMode.externalApplication);
}

Future<void> callNumber(String phone) async {
  final uri = Uri(scheme: 'tel', path: phone);
  if (await canLaunchUrl(uri)) await launchUrl(uri);
}

class NavigateButton extends StatelessWidget {
  final String label;
  final double lat;
  final double lng;
  const NavigateButton({super.key, required this.label, required this.lat, required this.lng});

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: () => openNavigation(lat, lng),
      icon: const Icon(Icons.navigation_rounded),
      label: Text(label, style: RoadLinkFonts.display(fontWeight: FontWeight.w700, letterSpacing: 1.1, fontSize: 16)),
      style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
    );
  }
}

const _eventLabels = <String, String>{
  'incident_created': 'Reported',
  'duplicate_report_merged': 'Another report merged',
  'police_notified': 'Police alerted',
  'police_accepted': 'Police accepted',
  'police_declined': 'Police declined',
  'police_on_scene': 'Police on scene',
  'scene_updated': 'Scene details updated',
  'scene_cleared': 'Scene cleared',
  'case_reference_recorded': 'Police case recorded',
  'ambulance_assigned': 'Ambulance assigned',
  'ambulance_reassigned': 'Ambulance changed',
  'ambulance_en_route': 'Ambulance en route',
  'ambulance_on_scene': 'Ambulance on scene',
  'ambulance_transporting': 'Transporting patient',
  'vitals_recorded': 'Patient vitals recorded',
  'ambulance_arrived_at_hospital': 'Ambulance at hospital',
  'hospital_notified': 'Hospital notified',
  'hospital_reassigned': 'Hospital changed',
  'hospital_acknowledged': 'Hospital acknowledged',
  'patient_admitted': 'Patient admitted',
  'incident_closed_completed': 'Closed',
  'incident_closed_false_alarm': 'Closed — false alarm',
  'incident_closed_cancelled': 'Closed — cancelled',
};

Future<void> showTimelineSheet(BuildContext context, RoadLinkApi api, Incident incident) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: AppColors.surface,
    isScrollControlled: true,
    builder: (_) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      maxChildSize: 0.9,
      builder: (context, scroll) => FutureBuilder<List<TimelineEntry>>(
        future: api.timeline(incident.id),
        builder: (context, snap) {
          Widget body;
          if (snap.hasError) {
            body = Padding(padding: const EdgeInsets.all(20), child: Text('${snap.error}', style: const TextStyle(color: AppColors.alert)));
          } else if (!snap.hasData) {
            body = const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()));
          } else {
            body = Column(
              children: snap.data!
                  .map((e) => ListTile(
                        dense: true,
                        leading: Text(fmtClock(e.at), style: GoogleFonts.ibmPlexSans(color: AppColors.textMuted)),
                        title: Text(_eventLabels[e.event] ?? e.event),
                        subtitle: Text('${e.actor}${e.note == null ? '' : ' · ${e.note}'}', style: const TextStyle(color: AppColors.textMuted)),
                      ))
                  .toList(),
            );
          }
          return ListView(
            controller: scroll,
            padding: const EdgeInsets.fromLTRB(8, 16, 8, 24),
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text('TIMELINE · ${incident.referenceNumber}', style: RoadLinkFonts.display(fontSize: 18, fontWeight: FontWeight.w700, letterSpacing: 1.5)),
              ),
              body,
            ],
          );
        },
      ),
    ),
  );
}
