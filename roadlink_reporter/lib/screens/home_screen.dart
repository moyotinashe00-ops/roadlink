import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/incident.dart';
import '../theme/app_theme.dart';
import '../widgets/hud_background.dart';
import '../widgets/pulse_sos_button.dart';
import 'report_screen.dart';
import 'status_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  // TODO: replace with the live RoadLink Dispatch centre number.
  static const _dispatchNumber = '999';

  Incident? _activeIncident;

  Future<void> _callDispatch() async {
    final uri = Uri(scheme: 'tel', path: _dispatchNumber);
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  Future<void> _openReportFlow() async {
    final result = await Navigator.of(context).push<Incident>(
      MaterialPageRoute(builder: (_) => const ReportScreen()),
    );
    if (result != null) {
      setState(() => _activeIncident = result);
      _openStatus(result);
    }
  }

  void _openStatus(Incident incident) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => StatusScreen(incident: incident)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: HudBackground(
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              children: [
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('ROADLINK', style: Theme.of(context).textTheme.displayLarge?.copyWith(fontSize: 28)),
                        Text(
                          'REPORTER',
                          style: GoogleFonts.rajdhani(
                            fontSize: 15,
                            letterSpacing: 4,
                            color: AppColors.amber,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        border: Border.all(color: AppColors.border),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 8,
                            height: 8,
                            decoration: const BoxDecoration(shape: BoxShape.circle, color: AppColors.safe),
                          ),
                          const SizedBox(width: 6),
                          Text('HARARE', style: GoogleFonts.ibmPlexSans(fontSize: 12, color: AppColors.textMuted)),
                        ],
                      ),
                    ),
                  ],
                ),
                const Spacer(),
                Text(
                  'Tap to report a road accident',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 18),
                PulseSosButton(onPressed: _openReportFlow),
                const SizedBox(height: 28),
                Text(
                  'Your location is captured automatically.\nNo account needed.',
                  textAlign: TextAlign.center,
                  style: GoogleFonts.ibmPlexSans(fontSize: 13, color: AppColors.textMuted),
                ),
                const Spacer(),
                if (_activeIncident != null) ...[
                  _ActiveReportCard(
                    incident: _activeIncident!,
                    onTap: () => _openStatus(_activeIncident!),
                  ),
                  const SizedBox(height: 16),
                ],
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: _callDispatch,
                    icon: const Icon(Icons.call, color: AppColors.amber),
                    label: Text(
                      'CALL DISPATCH CENTRE',
                      style: GoogleFonts.rajdhani(fontWeight: FontWeight.w700, letterSpacing: 1.2, color: AppColors.amber),
                    ),
                    style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ActiveReportCard extends StatelessWidget {
  final Incident incident;
  final VoidCallback onTap;
  const _ActiveReportCard({required this.incident, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            const Icon(Icons.route, color: AppColors.amber),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Active report ${incident.referenceNumber ?? ''}',
                    style: GoogleFonts.rajdhani(fontWeight: FontWeight.w700, fontSize: 16, color: AppColors.textPrimary),
                  ),
                  Text(incident.status.label, style: GoogleFonts.ibmPlexSans(fontSize: 13, color: AppColors.textMuted)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: AppColors.textMuted),
          ],
        ),
      ),
    );
  }
}
