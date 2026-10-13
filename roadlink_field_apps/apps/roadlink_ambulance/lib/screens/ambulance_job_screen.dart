import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:roadlink_shared/roadlink_shared.dart';

/// Number the crew can call for dispatch. Override at build time:  --dart-define=DISPATCH_NUMBER=+263...
const dispatchNumber = String.fromEnvironment('DISPATCH_NUMBER', defaultValue: '999');

String jobStateLabel(String? s) => switch (s) {
      'assigned' => 'Dispatched',
      'enRoute' => 'En route to scene',
      'onScene' => 'On scene',
      'transporting' => 'Transporting patient',
      'arrived' => 'Arrived at hospital',
      _ => 'Dispatched',
    };

/// The one-button workflow. Each step is irreversible server-side, hence the hold-to-confirm.
class _Step {
  final String next; // value sent to the server
  final String label;
  const _Step(this.next, this.label);
}

const _steps = <String, _Step>{
  'assigned': _Step('enRoute', 'START — EN ROUTE'),
  'enRoute': _Step('onScene', 'ARRIVED ON SCENE'),
  'onScene': _Step('transporting', 'PATIENT LOADED\nTRANSPORTING'),
  'transporting': _Step('arrived', 'ARRIVED AT HOSPITAL'),
};

class AmbulanceJobScreen extends StatelessWidget {
  final FieldController controller;
  final String incidentId;
  const AmbulanceJobScreen({super.key, required this.controller, required this.incidentId});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final inc = controller.incident(incidentId);
        if (inc == null) return const _JobGone();
        return _JobView(controller: controller, incident: inc);
      },
    );
  }
}

class _JobGone extends StatelessWidget {
  const _JobGone();

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
                const Icon(Icons.info_outline, size: 56, color: AppColors.amber),
                const SizedBox(height: 16),
                Text('This job was closed, cancelled or reassigned by dispatch.', textAlign: TextAlign.center, style: GoogleFonts.ibmPlexSans(fontSize: 16)),
                const SizedBox(height: 20),
                ElevatedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('BACK TO STANDBY')),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _JobView extends StatelessWidget {
  final FieldController controller;
  final Incident incident;
  const _JobView({required this.controller, required this.incident});

  FieldController get c => controller;

  @override
  Widget build(BuildContext context) {
    final amb = incident.ambulance;
    final state = amb?.state ?? 'assigned';
    final hospital = incident.hospital;
    final step = _steps[state];
    final heading = state == 'transporting' || state == 'arrived';

    // Where "navigate" points: the scene until the patient is loaded, then the hospital.
    final toHospital = heading && hospital != null && hospital.hasLocation;

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
              LiveIncidentMap(
                controller: c,
                userAgentPackage: 'zw.co.roadlink.ambulance',
                pins: [
                  Pins.scene(incident.lat, incident.lng),
                  if (hospital != null && hospital.hasLocation) Pins.hospital(hospital.lat!, hospital.lng!),
                ],
              ),
              const SizedBox(height: 14),
              LiveBanner(controller: c),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  FactTile('Patients', '${incident.patients}${incident.verifiedVictimCount != null ? ' ✓' : ''}'),
                  FactTile('Status', jobStateLabel(state)),
                  SeverityBadge(incident.severity),
                ],
              ),
              if (incident.isApproximate) _Callout('Location is approximate (USSD report near "${incident.locationLabel ?? 'an area'}"). Dispatch is confirming the exact spot.', AppColors.amber),
              if (incident.hazardNotes != null) _Callout('HAZARD: ${incident.hazardNotes}', AppColors.amber),
              if (incident.police?.state == 'onScene' || incident.police?.state == 'cleared')
                _Callout('Police are on scene (${incident.police!.name}).', const Color(0xFF3AA0FF)),
              if (incident.description.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(incident.description, style: GoogleFonts.ibmPlexSans(color: AppColors.textMuted)),
              ],
              const SizedBox(height: 14),
              _HospitalBlock(incident: incident, heading: heading),
              const SizedBox(height: 14),
              NavigateButton(
                label: toHospital ? 'NAVIGATE TO ${hospital.name.toUpperCase()}' : 'NAVIGATE TO SCENE',
                lat: toHospital ? hospital.lat! : incident.lat,
                lng: toHospital ? hospital.lng! : incident.lng,
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => callNumber(dispatchNumber),
                      icon: const Icon(Icons.support_agent),
                      label: const Text('CALL DISPATCH'),
                    ),
                  ),
                  if (hospital?.phone != null) ...[
                    const SizedBox(width: 10),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => callNumber(hospital!.phone!),
                        icon: const Icon(Icons.local_hospital),
                        label: const Text('CALL HOSPITAL'),
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 22),
              if (step != null)
                HoldToConfirmButton(
                  label: step.label,
                  onConfirmed: c.busy ? null : () => runGuarded(context, () => c.ambulanceStatus(incident.id, step.next)),
                )
              else
                _HandedOver(controller: c),
            ],
          ),
        ),
      ),
    );
  }
}

class _HospitalBlock extends StatelessWidget {
  final Incident incident;
  final bool heading;
  const _HospitalBlock({required this.incident, required this.heading});

  @override
  Widget build(BuildContext context) {
    final h = incident.hospital;
    if (h == null) {
      return _Callout(
        heading ? 'No hospital assigned yet. Call dispatch for the receiving hospital.' : 'Receiving hospital not chosen yet — dispatch will assign one.',
        heading ? AppColors.alert : AppColors.textMuted,
      );
    }
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppColors.safe.withValues(alpha: 0.5))),
      child: Row(
        children: [
          const Icon(Icons.local_hospital_rounded, color: AppColors.safe),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('RECEIVING HOSPITAL', style: GoogleFonts.ibmPlexSans(fontSize: 10, letterSpacing: 1.6, color: AppColors.textMuted)),
                Text(h.name, style: GoogleFonts.rajdhani(fontSize: 20, fontWeight: FontWeight.w700)),
              ],
            ),
          ),
          Text(h.state == 'acknowledged' ? 'Preparing' : h.state == 'admitted' ? 'Admitted' : 'Notified',
              style: GoogleFonts.ibmPlexSans(color: AppColors.safe, fontSize: 13)),
        ],
      ),
    );
  }
}

class _HandedOver extends StatelessWidget {
  final FieldController controller;
  const _HandedOver({required this.controller});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text('Patient handed over. Waiting for the hospital to confirm admission.',
            textAlign: TextAlign.center, style: GoogleFonts.ibmPlexSans(color: AppColors.safe)),
        const SizedBox(height: 14),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: controller.busy
                ? null
                : () async {
                    final ok = await runGuarded(context, () => controller.setAvailable(true));
                    if (ok && context.mounted) Navigator.of(context).pop();
                  },
            icon: const Icon(Icons.check_circle),
            label: Text('READY FOR NEXT JOB', style: GoogleFonts.rajdhani(fontSize: 19, fontWeight: FontWeight.w800, letterSpacing: 1.4)),
            style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 18), backgroundColor: AppColors.safe, foregroundColor: Colors.black),
          ),
        ),
      ],
    );
  }
}

class _Callout extends StatelessWidget {
  final String text;
  final Color color;
  const _Callout(this.text, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), border: Border.all(color: color.withValues(alpha: 0.6)), borderRadius: BorderRadius.circular(10)),
      child: Text(text, style: GoogleFonts.ibmPlexSans(fontSize: 13, color: color)),
    );
  }
}
