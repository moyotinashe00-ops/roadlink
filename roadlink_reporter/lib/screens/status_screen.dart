import 'dart:async';

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/incident.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/hud_background.dart';
import '../widgets/status_timeline.dart';

/// Implements CIT-09: the reporter can watch their own report's live
/// status without needing to phone anyone back.
class StatusScreen extends StatefulWidget {
  final Incident incident;
  const StatusScreen({super.key, required this.incident});

  @override
  State<StatusScreen> createState() => _StatusScreenState();
}

class _StatusScreenState extends State<StatusScreen> {
  final _apiService = ApiService();
  late Incident _incident;
  StreamSubscription<Incident>? _sub;

  @override
  void initState() {
    super.initState();
    _incident = widget.incident;
    _sub = _apiService.watchIncident(_incident).listen((updated) {
      if (mounted) setState(() => _incident = updated);
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final closed = _incident.status == IncidentStatus.admitted;
    return Scaffold(
      appBar: AppBar(title: const Text('LIVE STATUS')),
      body: HudBackground(
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('REFERENCE', style: GoogleFonts.ibmPlexSans(fontSize: 12, letterSpacing: 2, color: AppColors.textMuted)),
                    const SizedBox(height: 4),
                    Text(
                      _incident.referenceNumber ?? '—',
                      style: GoogleFonts.rajdhani(fontSize: 32, fontWeight: FontWeight.w800, color: AppColors.amber),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Container(
                          width: 10,
                          height: 10,
                          margin: const EdgeInsets.only(right: 8),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: closed ? AppColors.safe : AppColors.alert,
                          ),
                        ),
                        Expanded(
                          child: Text(
                            _incident.status.label,
                            style: GoogleFonts.ibmPlexSans(fontSize: 15, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 28),
              Text(
                'RESPONSE TIMELINE',
                style: GoogleFonts.rajdhani(fontSize: 15, fontWeight: FontWeight.w700, letterSpacing: 1.4, color: AppColors.textMuted),
              ),
              const SizedBox(height: 16),
              StatusTimeline(current: _incident.status),
              if (closed)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(
                    'Patient admitted. Thank you for reporting.',
                    style: GoogleFonts.ibmPlexSans(color: AppColors.safe),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
