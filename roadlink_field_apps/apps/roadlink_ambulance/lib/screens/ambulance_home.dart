import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:roadlink_shared/roadlink_shared.dart';

import 'ambulance_job_screen.dart';

class AmbulanceHome extends StatefulWidget {
  final FieldController controller;
  const AmbulanceHome({super.key, required this.controller});

  @override
  State<AmbulanceHome> createState() => _AmbulanceHomeState();
}

class _AmbulanceHomeState extends State<AmbulanceHome> {
  StreamSubscription<Incident>? _alertSub;
  bool _dialogOpen = false;

  FieldController get c => widget.controller;

  @override
  void initState() {
    super.initState();
    _alertSub = c.alerts.listen(_onNewJob);
  }

  @override
  void dispose() {
    _alertSub?.cancel();
    super.dispose();
  }

  Future<void> _onNewJob(Incident inc) async {
    if (!mounted || _dialogOpen) return;
    _dialogOpen = true;
    // Three pulses + the system alert tone: this has to be noticed over a siren and a radio.
    for (var i = 0; i < 3; i++) {
      HapticFeedback.heavyImpact();
      SystemSound.play(SystemSoundType.alert);
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }
    if (!mounted) return;
    final go = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _NewJobDialog(incident: inc),
    );
    _dialogOpen = false;
    if (go == true && mounted) _open(inc.id);
  }

  void _open(String id) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => AmbulanceJobScreen(controller: c, incidentId: id)));
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final jobs = c.incidents.where((i) => i.ambulance != null).toList();
        final current = jobs.where((i) => i.ambulance!.state != 'arrived').toList();
        final handedOver = jobs.where((i) => i.ambulance!.state == 'arrived').toList();

        return Scaffold(
          appBar: AppBar(
            title: const Text('AMBULANCE'),
            actions: [
              IconButton(tooltip: 'Refresh', icon: const Icon(Icons.refresh), onPressed: c.refresh),
              IconButton(tooltip: 'Sign out', icon: const Icon(Icons.logout), onPressed: () => c.signOut()),
            ],
          ),
          body: HudBackground(
            child: SafeArea(
              child: RefreshIndicator(
                onRefresh: c.refresh,
                child: ListView(
                  padding: const EdgeInsets.all(18),
                  children: [
                    Text(c.user?.name ?? '', style: Theme.of(context).textTheme.bodyMedium),
                    const SizedBox(height: 10),
                    LiveBanner(controller: c),
                    DutyToggle(
                      label: c.me?.label ?? 'My vehicle',
                      available: c.isAvailable,
                      busy: c.busy,
                      onChanged: (v) => runGuarded(context, () => c.setAvailable(v)),
                    ),
                    const SizedBox(height: 24),
                    if (current.isEmpty) _Standby(available: c.isAvailable),
                    for (final j in current) _JobCard(incident: j, onTap: () => _open(j.id)),
                    if (handedOver.isNotEmpty) ...[
                      const SizedBox(height: 18),
                      Text('HANDED OVER — AWAITING HOSPITAL',
                          style: GoogleFonts.rajdhani(fontSize: 14, fontWeight: FontWeight.w700, letterSpacing: 2, color: AppColors.textMuted)),
                      const SizedBox(height: 8),
                      for (final j in handedOver)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(j.referenceNumber, style: GoogleFonts.rajdhani(fontSize: 18, fontWeight: FontWeight.w700)),
                          subtitle: Text(j.hospital?.name ?? 'Hospital', style: const TextStyle(color: AppColors.textMuted)),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => _open(j.id),
                        ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _Standby extends StatelessWidget {
  final bool available;
  const _Standby({required this.available});

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 22),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
        gradient: RadialGradient(colors: [accent.withValues(alpha: 0.14), Colors.transparent], radius: 1.1),
      ),
      child: Column(
        children: [
          Icon(Icons.radar, size: 58, color: available ? accent : AppColors.textMuted),
          const SizedBox(height: 14),
          Text(available ? 'STANDING BY' : 'OFF DUTY', style: GoogleFonts.rajdhani(fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: 3)),
          const SizedBox(height: 8),
          Text(
            available
                ? 'Dispatch can see your position. A new job will alert you here.'
                : 'Switch on "Available" to appear in dispatch recommendations.',
            textAlign: TextAlign.center,
            style: GoogleFonts.ibmPlexSans(color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }
}

class _JobCard extends StatelessWidget {
  final Incident incident;
  final VoidCallback onTap;
  const _JobCard({required this.incident, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: accent, width: 2),
          boxShadow: [BoxShadow(color: accent.withValues(alpha: 0.3), blurRadius: 18)],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('ACTIVE JOB', style: GoogleFonts.rajdhani(fontSize: 14, fontWeight: FontWeight.w700, letterSpacing: 2, color: accent)),
                SeverityBadge(incident.severity),
              ],
            ),
            const SizedBox(height: 6),
            Text(incident.referenceNumber, style: GoogleFonts.rajdhani(fontSize: 30, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text(
              '${incident.patients} patient${incident.patients == 1 ? '' : 's'} · ${jobStateLabel(incident.ambulance?.state)}',
              style: GoogleFonts.ibmPlexSans(color: AppColors.textMuted),
            ),
            const SizedBox(height: 10),
            Text('OPEN JOB  →', style: GoogleFonts.rajdhani(fontSize: 16, fontWeight: FontWeight.w800, letterSpacing: 2)),
          ],
        ),
      ),
    );
  }
}

class _NewJobDialog extends StatelessWidget {
  final Incident incident;
  const _NewJobDialog({required this.incident});

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: const BorderSide(color: AppColors.alert, width: 2)),
      title: Text('NEW EMERGENCY JOB', style: GoogleFonts.rajdhani(fontSize: 24, fontWeight: FontWeight.w800, color: AppColors.alert, letterSpacing: 1.4)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Text(incident.referenceNumber, style: GoogleFonts.rajdhani(fontSize: 26, fontWeight: FontWeight.w800)),
            SeverityBadge(incident.severity),
          ]),
          const SizedBox(height: 12),
          Row(children: [
            FactTile('Patients', '${incident.patients}'),
            const SizedBox(width: 28),
            FactTile('ETA', incident.ambulance?.etaMinutes == null ? '—' : '${incident.ambulance!.etaMinutes} min'),
          ]),
          if (incident.description.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(incident.description, style: GoogleFonts.ibmPlexSans(color: AppColors.textMuted)),
          ],
        ],
      ),
      actions: [
        ElevatedButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Padding(padding: EdgeInsets.symmetric(horizontal: 12, vertical: 10), child: Text('VIEW JOB')),
        ),
      ],
    );
  }
}
