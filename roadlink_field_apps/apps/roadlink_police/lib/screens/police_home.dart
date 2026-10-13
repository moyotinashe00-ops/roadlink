import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:roadlink_shared/roadlink_shared.dart';

import 'police_incident_screen.dart';

String policeStateLabel(String? s) => switch (s) {
      'notified' => 'ALERTED — respond now',
      'accepted' => 'Accepted — en route',
      'onScene' => 'On scene',
      'cleared' => 'Scene cleared',
      _ => 'Not assigned',
    };

const declineReasons = [
  'Attending another incident',
  'Outside my patrol area',
  'Vehicle unavailable',
  'Off duty',
];

class PoliceHome extends StatefulWidget {
  final FieldController controller;
  const PoliceHome({super.key, required this.controller});

  @override
  State<PoliceHome> createState() => _PoliceHomeState();
}

class _PoliceHomeState extends State<PoliceHome> {
  StreamSubscription<Incident>? _alertSub;
  bool _dialogOpen = false;

  FieldController get c => widget.controller;

  @override
  void initState() {
    super.initState();
    _alertSub = c.alerts.listen(_onAlert);
  }

  @override
  void dispose() {
    _alertSub?.cancel();
    super.dispose();
  }

  Future<void> _onAlert(Incident inc) async {
    // Only interrupt for an incident this unit has to respond to.
    if (!mounted || _dialogOpen || inc.police?.state != 'notified') return;
    _dialogOpen = true;
    HapticFeedback.heavyImpact();
    final choice = await showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _IncomingAlertDialog(incident: inc),
    );
    _dialogOpen = false;
    if (!mounted) return;

    if (choice == 'accept') {
      final ok = await runGuarded(context, () => c.policeAccept(inc.id));
      if (ok && mounted) _open(inc.id);
    } else if (choice == 'decline') {
      await _decline(inc);
    }
    // 'later': it stays in the list, still marked ALERTED.
  }

  Future<void> _decline(Incident inc) async {
    final reason = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(padding: EdgeInsets.all(16), child: Text('Why can\'t you attend?')),
            for (final r in declineReasons) ListTile(title: Text(r), onTap: () => Navigator.pop(context, r)),
          ],
        ),
      ),
    );
    if (reason == null || !mounted) return;
    String? to;
    final ok = await runGuarded(context, () async => to = await c.policeDecline(inc.id, reason));
    if (ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(to == null ? 'Declined. No other unit was available — dispatch has been told.' : 'Declined. Passed to $to.')),
      );
    }
  }

  void _open(String id) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => PoliceIncidentScreen(controller: c, incidentId: id)));
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final items = c.incidents;
        return Scaffold(
          appBar: AppBar(
            title: const Text('POLICE'),
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
                      label: c.me?.label ?? 'My unit',
                      available: c.isAvailable,
                      busy: c.busy,
                      onChanged: (v) => runGuarded(context, () => c.setAvailable(v)),
                    ),
                    const SizedBox(height: 24),
                    Text('ACTIVE INCIDENTS  ${items.length}',
                        style: GoogleFonts.rajdhani(fontSize: 15, fontWeight: FontWeight.w700, letterSpacing: 2, color: AppColors.textMuted)),
                    const SizedBox(height: 12),
                    if (items.isEmpty)
                      Container(
                        padding: const EdgeInsets.all(22),
                        decoration: BoxDecoration(border: Border.all(color: AppColors.border), borderRadius: BorderRadius.circular(14)),
                        child: Text(
                          c.isAvailable
                              ? 'Standing by. You will be alerted the moment an accident is reported near you.'
                              : 'You are off the dispatch list. Switch on "Available" to receive alerts.',
                          style: GoogleFonts.ibmPlexSans(color: AppColors.textMuted),
                        ),
                      ),
                    for (final i in items) _IncidentTile(incident: i, onTap: () => _open(i.id)),
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

class _IncidentTile extends StatelessWidget {
  final Incident incident;
  final VoidCallback onTap;
  const _IncidentTile({required this.incident, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final alerted = incident.police?.state == 'notified';
    final accent = Theme.of(context).colorScheme.primary;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: alerted ? AppColors.alert : AppColors.border, width: alerted ? 2 : 1),
          boxShadow: alerted ? [BoxShadow(color: AppColors.alert.withValues(alpha: 0.35), blurRadius: 18)] : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(incident.referenceNumber, style: GoogleFonts.rajdhani(fontSize: 22, fontWeight: FontWeight.w800)),
                SeverityBadge(incident.severity),
              ],
            ),
            const SizedBox(height: 6),
            Text(policeStateLabel(incident.police?.state),
                style: GoogleFonts.rajdhani(fontSize: 16, fontWeight: FontWeight.w700, color: alerted ? AppColors.alert : accent)),
            const SizedBox(height: 8),
            Text(
              '${incident.patients} patient${incident.patients == 1 ? '' : 's'}'
              '${incident.locationLabel == null ? '' : ' · near ${incident.locationLabel}'}'
              '${incident.ambulance == null ? '' : ' · ambulance ${incident.ambulance!.plate}'}',
              style: GoogleFonts.ibmPlexSans(color: AppColors.textMuted, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}

class _IncomingAlertDialog extends StatelessWidget {
  final Incident incident;
  const _IncomingAlertDialog({required this.incident});

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: const BorderSide(color: AppColors.alert, width: 2)),
      title: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text('ACCIDENT NEARBY', style: GoogleFonts.rajdhani(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.alert, letterSpacing: 1.4)),
          SeverityBadge(incident.severity),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(incident.referenceNumber, style: GoogleFonts.rajdhani(fontSize: 26, fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          Row(children: [
            FactTile('Patients', '${incident.patients}'),
            const SizedBox(width: 28),
            FactTile('Location', incident.locationLabel ?? (incident.isApproximate ? 'Approximate' : 'GPS fix')),
          ]),
          if (incident.description.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(incident.description, style: GoogleFonts.ibmPlexSans(color: AppColors.textMuted)),
          ],
        ],
      ),
      actionsAlignment: MainAxisAlignment.spaceBetween,
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, 'decline'), child: const Text('CAN\'T ATTEND')),
        TextButton(onPressed: () => Navigator.pop(context, 'later'), child: const Text('LATER')),
        ElevatedButton(onPressed: () => Navigator.pop(context, 'accept'), child: const Text('ACCEPT')),
      ],
    );
  }
}
