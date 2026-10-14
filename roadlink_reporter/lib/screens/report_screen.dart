import 'dart:io';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/incident.dart';
import '../services/api_service.dart';
import '../services/location_service.dart';
import '../theme/app_theme.dart';
import '../widgets/hud_background.dart';
import '../widgets/severity_selector.dart';

class ReportScreen extends StatefulWidget {
  const ReportScreen({super.key});

  @override
  State<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends State<ReportScreen> {
  final _locationService = LocationService();
  final _apiService = ApiService();
  final _descriptionController = TextEditingController();
  final _picker = ImagePicker();

  Position? _position;
  bool _locating = true;
  String? _locationError;
  int _victimCount = 1;
  Severity _severity = Severity.minor;
  XFile? _photo;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _captureLocation();
  }

  @override
  void dispose() {
    _apiService.close();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _captureLocation() async {
    setState(() {
      _locating = true;
      _locationError = null;
    });
    try {
      final pos = await _locationService.getCurrentPosition();
      setState(() {
        _position = pos;
        _locating = false;
      });
    } catch (e) {
      setState(() {
        _locationError = e.toString();
        _locating = false;
      });
    }
  }

  Future<void> _pickPhoto(ImageSource source) async {
    final file = await _picker.pickImage(source: source, maxWidth: 1600, imageQuality: 80);
    if (file != null) setState(() => _photo = file);
  }

  void _showPhotoSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (_) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera, color: AppColors.amber),
              title: const Text('Take photo'),
              onTap: () {
                Navigator.pop(context);
                _pickPhoto(ImageSource.camera);
              },
            ),
            ListTile(
              leading: const Icon(Icons.photo_library, color: AppColors.amber),
              title: const Text('Choose from gallery'),
              onTap: () {
                Navigator.pop(context);
                _pickPhoto(ImageSource.gallery);
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    if (_position == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Waiting for GPS location — try again in a moment.')),
      );
      return;
    }

    setState(() => _submitting = true);

    final draft = Incident(
      latitude: _position!.latitude,
      longitude: _position!.longitude,
      victimCount: _victimCount,
      severity: _severity,
      description: _descriptionController.text.trim(),
      photoPath: _photo?.path,
      status: IncidentStatus.reported,
      createdAt: DateTime.now(),
    );

    try {
      final saved = await _apiService.submitIncident(draft);
      if (!mounted) return;
      Navigator.of(context).pop(saved);
    } on PhotoUploadException catch (error) {
      if (!mounted) return;
      await _showPhotoUploadWarning(error.message);
      if (mounted) Navigator.of(context).pop(error.incident);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _submitting = false);
      _showFallbackDialog(error.message);
    }
  }

  // Implements CIT-08's intent through channel redundancy rather than
  // offline queueing: if the network can't be reached, offer the
  // always-available voice-call channel immediately instead of silently
  // storing the report for later.
  void _showFallbackDialog(String error) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('Could not reach the network'),
        content: Text('$error\n\nYour report was not sent. Call dispatch or try again.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('RETRY')),
          TextButton(
            onPressed: () async {
              Navigator.pop(context);
              final uri = Uri(scheme: 'tel', path: '999');
              if (await canLaunchUrl(uri)) await launchUrl(uri);
            },
            child: const Text('CALL DISPATCH'),
          ),
        ],
      ),
    );
  }

  Future<void> _showPhotoUploadWarning(String message) {
    return showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('Report sent; photo not attached'),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('VIEW LIVE STATUS'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('REPORT ACCIDENT')),
      body: HudBackground(
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              _LocationCard(
                locating: _locating,
                position: _position,
                error: _locationError,
                onRetry: _captureLocation,
              ),
              const SizedBox(height: 24),
              Text('How many people are involved?', style: GoogleFonts.rajdhani(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
              const SizedBox(height: 10),
              _VictimStepper(value: _victimCount, onChanged: (v) => setState(() => _victimCount = v)),
              const SizedBox(height: 24),
              Text('How serious does it look?', style: GoogleFonts.rajdhani(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
              const SizedBox(height: 10),
              SeveritySelector(value: _severity, onChanged: (s) => setState(() => _severity = s)),
              const SizedBox(height: 24),
              Text('Description (optional)', style: GoogleFonts.rajdhani(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
              const SizedBox(height: 10),
              TextField(
                controller: _descriptionController,
                maxLines: 3,
                maxLength: 240,
                decoration: const InputDecoration(
                  hintText: 'e.g. Two cars collided near the roundabout, one person trapped.',
                ),
              ),
              const SizedBox(height: 8),
              GestureDetector(
                onTap: _showPhotoSheet,
                child: Container(
                  height: 90,
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: _photo == null
                      ? Center(
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Icons.add_a_photo, color: AppColors.textMuted),
                              const SizedBox(width: 8),
                              Text('Attach a photo (optional)', style: GoogleFonts.ibmPlexSans(color: AppColors.textMuted)),
                            ],
                          ),
                        )
                      : ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: Image.file(File(_photo!.path), fit: BoxFit.cover, width: double.infinity),
                        ),
                ),
              ),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _submitting ? null : _submit,
                  style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 18)),
                  child: _submitting
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                        )
                      : Text(
                          'SEND REPORT',
                          style: GoogleFonts.rajdhani(fontSize: 18, fontWeight: FontWeight.w800, letterSpacing: 1.4, color: Colors.white),
                        ),
                ),
              ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }
}

class _LocationCard extends StatelessWidget {
  final bool locating;
  final Position? position;
  final String? error;
  final VoidCallback onRetry;

  const _LocationCard({
    required this.locating,
    required this.position,
    required this.error,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Icon(
            error != null ? Icons.location_off : Icons.location_on,
            color: error != null ? AppColors.alert : AppColors.safe,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: locating
                ? Text('Locking GPS location…', style: GoogleFonts.ibmPlexSans(color: AppColors.textMuted))
                : error != null
                    ? Text(error!, style: GoogleFonts.ibmPlexSans(color: AppColors.alert, fontSize: 13))
                    : Text(
                        'Location locked: ${position!.latitude.toStringAsFixed(5)}, ${position!.longitude.toStringAsFixed(5)}',
                        style: GoogleFonts.ibmPlexSans(color: AppColors.textPrimary, fontSize: 13),
                      ),
          ),
          if (locating)
            const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.amber))
          else if (error != null)
            TextButton(onPressed: onRetry, child: const Text('RETRY')),
        ],
      ),
    );
  }
}

class _VictimStepper extends StatelessWidget {
  final int value;
  final ValueChanged<int> onChanged;
  const _VictimStepper({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          IconButton(
            onPressed: value > 1 ? () => onChanged(value - 1) : null,
            icon: const Icon(Icons.remove_circle_outline, color: AppColors.amber),
          ),
          Text('$value', style: GoogleFonts.rajdhani(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
          IconButton(
            onPressed: () => onChanged(value + 1),
            icon: const Icon(Icons.add_circle_outline, color: AppColors.amber),
          ),
        ],
      ),
    );
  }
}
