import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:roadlink_shared/roadlink_shared.dart';

import 'police_home.dart';

class PoliceIncidentScreen extends StatelessWidget {
  final FieldController controller;
  final String incidentId;
  const PoliceIncidentScreen({super.key, required this.controller, required this.incidentId});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final inc = controller.incident(incidentId);
        if (inc == null) return const _NoLongerAssigned();
        return _IncidentView(controller: controller, incident: inc);
      },
    );
  }
}

class _NoLongerAssigned extends StatelessWidget {
  const _NoLongerAssigned();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(),
      body: HudBackground(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.check_circle_outline, size: 56, color: AppColors.safe),
                const SizedBox(height: 16),
                Text('This incident is closed or no longer assigned to your unit.',
                    textAlign: TextAlign.center, style: GoogleFonts.ibmPlexSans(fontSize: 16)),
                const SizedBox(height: 20),
                ElevatedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('BACK')),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _IncidentView extends StatelessWidget {
  final FieldController controller;
  final Incident incident;
  const _IncidentView({required this.controller, required this.incident});

  FieldController get c => controller;
  String get id => incident.id;
  String? get state => incident.police?.state;

  Future<void> _decline(BuildContext context) async {
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
    if (reason == null || !context.mounted) return;
    String? to;
    final ok = await runGuarded(context, () async => to = await c.policeDecline(id, reason));
    if (ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(to == null ? 'Declined. No other unit available — dispatch has been told.' : 'Declined. Passed to $to.')),
      );
      Navigator.of(context).pop();
    }
  }

  Future<void> _caseNumber(BuildContext context) async {
    final ctl = TextEditingController(text: incident.caseReference ?? '');
    final value = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('Police case number'),
        content: TextField(controller: ctl, autofocus: true, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(hintText: 'e.g. CR 123/26')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('CANCEL')),
          ElevatedButton(onPressed: () => Navigator.pop(context, ctl.text.trim()), child: const Text('SAVE')),
        ],
      ),
    );
    ctl.dispose();
    if (value == null || value.length < 3 || !context.mounted) return;
    await runGuarded(context, () => c.caseReference(id, value));
  }

  Future<void> _sceneUpdate(BuildContext context) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      builder: (_) => _SceneSheet(controller: c, incident: incident),
    );
  }

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    final busy = c.busy;
    final canUpdate = state == 'accepted' || state == 'onScene' || state == 'cleared';

    return Scaffold(
      appBar: AppBar(
        title: Text(incident.referenceNumber),
        actions: [IconButton(tooltip: 'Timeline', icon: const Icon(Icons.history), onPressed: () => showTimelineSheet(context, c.api, incident))],
      ),
      body: HudBackground(
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(18),
            children: [
              LiveIncidentMap(controller: c, pins: [Pins.scene(incident.lat, incident.lng)], userAgentPackage: 'zw.co.roadlink.police'),
              const SizedBox(height: 14),
              if (incident.isApproximate)
                _Note('Location is approximate (reported by USSD from "${incident.locationLabel ?? 'an area'}"). Confirm the exact spot with dispatch.', AppColors.amber),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  FactTile('Patients', '${incident.patients}${incident.verifiedVictimCount != null ? ' ✓' : ''}'),
                  SeverityBadge(incident.severity),
                ],
              ),
              const SizedBox(height: 12),
              if (incident.description.isNotEmpty) Text(incident.description, style: GoogleFonts.ibmPlexSans(color: AppColors.textPrimary)),
              if (incident.hazardNotes != null) _Note('Hazard: ${incident.hazardNotes}', AppColors.amber),
              const SizedBox(height: 10),
              _ResponseLine(Icons.local_police_rounded, 'Police', policeStateLabel(state), accent),
              if (incident.ambulance != null)
                _ResponseLine(Icons.emergency_rounded, 'Ambulance ${incident.ambulance!.plate}', _ambLabel(incident.ambulance!.state), AppColors.alert),
              if (incident.hospital != null)
                _ResponseLine(Icons.local_hospital_rounded, incident.hospital!.name, incident.hospital!.state ?? '', AppColors.safe),
              if (incident.caseReference != null) _ResponseLine(Icons.folder_open_rounded, 'Case', incident.caseReference!, AppColors.amber),
              const SizedBox(height: 16),
              NavigateButton(label: 'NAVIGATE TO SCENE', lat: incident.lat, lng: incident.lng),
              const SizedBox(height: 18),

              // ---- state-driven actions ------------------------------------
              if (state == 'notified') ...[
                _Primary('ACCEPT INCIDENT', Icons.check, busy ? null : () => runGuarded(context, () => c.policeAccept(id))),
                const SizedBox(height: 10),
                TextButton(onPressed: busy ? null : () => _decline(context), child: const Text('CAN\'T ATTEND — PASS TO NEXT UNIT')),
              ],
              if (state == 'accepted') _Primary('I\'M ON SCENE', Icons.place, busy ? null : () => runGuarded(context, () => c.policeOnScene(id))),
              if (state == 'onScene') ...[
                _Primary('SCENE CLEARED', Icons.verified, busy ? null : () => runGuarded(context, () => c.policeClear(id))),
              ],
              if (canUpdate) ...[
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: busy ? null : () => _sceneUpdate(context),
                  icon: const Icon(Icons.edit_note),
                  label: const Text('UPDATE SCENE DETAILS'),
                  style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: busy ? null : () => _caseNumber(context),
                  icon: const Icon(Icons.folder_open),
                  label: Text(incident.caseReference == null ? 'RECORD CASE NUMBER' : 'EDIT CASE NUMBER'),
                  style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  static String _ambLabel(String? s) => switch (s) {
        'assigned' => 'dispatched',
        'enRoute' => 'en route',
        'onScene' => 'on scene',
        'transporting' => 'transporting',
        'arrived' => 'at hospital',
        _ => '',
      };
}

class _Primary extends StatelessWidget {
  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  const _Primary(this.label, this.icon, this.onPressed);

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: onPressed,
        icon: Icon(icon),
        label: Text(label, style: RoadLinkFonts.display(fontSize: 19, fontWeight: FontWeight.w800, letterSpacing: 1.4)),
        style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 18)),
      ),
    );
  }
}

class _Note extends StatelessWidget {
  final String text;
  final Color color;
  const _Note(this.text, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 10, bottom: 4),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), border: Border.all(color: color.withValues(alpha: 0.6)), borderRadius: BorderRadius.circular(10)),
      child: Text(text, style: GoogleFonts.ibmPlexSans(fontSize: 13, color: color)),
    );
  }
}

class _ResponseLine extends StatelessWidget {
  final IconData icon;
  final String who;
  final String what;
  final Color color;
  const _ResponseLine(this.icon, this.who, this.what, this.color);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(icon, size: 20, color: color),
          const SizedBox(width: 10),
          Expanded(child: Text(who, style: GoogleFonts.ibmPlexSans(fontWeight: FontWeight.w600))),
          Text(what, style: GoogleFonts.ibmPlexSans(color: AppColors.textMuted, fontSize: 13)),
        ],
      ),
    );
  }
}

class _SceneSheet extends StatefulWidget {
  final FieldController controller;
  final Incident incident;
  const _SceneSheet({required this.controller, required this.incident});

  @override
  State<_SceneSheet> createState() => _SceneSheetState();
}

class _SceneSheetState extends State<_SceneSheet> {
  late int _victims;
  late Severity _severity;
  late final TextEditingController _hazard;

  @override
  void initState() {
    super.initState();
    _victims = widget.incident.patients;
    _severity = widget.incident.severity;
    _hazard = TextEditingController(text: widget.incident.hazardNotes ?? '');
  }

  @override
  void dispose() {
    _hazard.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final ok = await runGuarded(
      context,
      () => widget.controller.sceneUpdate(widget.incident.id, victims: _victims, hazard: _hazard.text.trim(), severity: _severity),
    );
    if (ok && mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('SCENE DETAILS', style: RoadLinkFonts.display(fontSize: 18, fontWeight: FontWeight.w700, letterSpacing: 1.6)),
          const SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Confirmed patients'),
              Row(children: [
                IconButton(onPressed: _victims > 0 ? () => setState(() => _victims--) : null, icon: const Icon(Icons.remove_circle_outline)),
                Text('$_victims', style: RoadLinkFonts.display(fontSize: 24, fontWeight: FontWeight.w800)),
                IconButton(onPressed: () => setState(() => _victims++), icon: const Icon(Icons.add_circle_outline)),
              ]),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              for (final s in Severity.values)
                ChoiceChip(
                  label: Text(s.label),
                  selected: s == _severity,
                  selectedColor: s.color.withValues(alpha: 0.3),
                  onSelected: (_) => setState(() => _severity = s),
                ),
            ],
          ),
          const SizedBox(height: 14),
          TextField(controller: _hazard, maxLines: 2, maxLength: 500, decoration: const InputDecoration(hintText: 'Hazards: fuel spill, lane blocked, power line down…')),
          const SizedBox(height: 8),
          SizedBox(width: double.infinity, child: ElevatedButton(onPressed: widget.controller.busy ? null : _save, child: const Padding(padding: EdgeInsets.all(14), child: Text('SAVE & NOTIFY DISPATCH')))),
        ],
      ),
    );
  }
}
