import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Matches SRS §4.1 (CIT-04): a short, predefined severity list.
enum Severity { minor, serious, critical, fatal }

extension SeverityX on Severity {
  String get label => switch (this) {
        Severity.minor => 'Minor',
        Severity.serious => 'Serious',
        Severity.critical => 'Critical',
        Severity.fatal => 'Fatalities',
      };

  String get apiValue => name;

  Color get color => switch (this) {
        Severity.minor => AppColors.safe,
        Severity.serious => AppColors.amber,
        Severity.critical => AppColors.alert,
        Severity.fatal => const Color(0xFF7A1620),
      };

  IconData get icon => switch (this) {
        Severity.minor => Icons.directions_car_filled_outlined,
        Severity.serious => Icons.warning_amber_rounded,
        Severity.critical => Icons.local_hospital_outlined,
        Severity.fatal => Icons.priority_high_rounded,
      };

  static Severity fromApi(String value) => Severity.values.firstWhere(
        (s) => s.name == value,
        orElse: () => Severity.minor,
      );
}

/// Matches SRS §5.3: the ordered lifecycle a reported incident moves through.
enum IncidentStatus {
  reported,
  policeNotified,
  policeOnScene,
  ambulanceAssigned,
  ambulanceEnRoute,
  ambulanceOnScene,
  transporting,
  hospitalNotified,
  admitted,
  closed,
}

extension IncidentStatusX on IncidentStatus {
  String get label => switch (this) {
        IncidentStatus.reported => 'Reported',
        IncidentStatus.policeNotified => 'Nearest police unit notified',
        IncidentStatus.policeOnScene => 'Police on scene',
        IncidentStatus.ambulanceAssigned => 'Ambulance assigned',
        IncidentStatus.ambulanceEnRoute => 'Ambulance en route',
        IncidentStatus.ambulanceOnScene => 'Ambulance on scene',
        IncidentStatus.transporting => 'Transporting patient',
        IncidentStatus.hospitalNotified => 'Receiving hospital notified',
        IncidentStatus.admitted => 'Patient admitted',
        IncidentStatus.closed => 'Closed',
      };

  static IncidentStatus fromApi(String value) => IncidentStatus.values.firstWhere(
        (s) => s.name == value,
        orElse: () => IncidentStatus.reported,
      );
}

class Incident {
  final String? id;
  final String? referenceNumber;
  final double latitude;
  final double longitude;
  final int victimCount;
  final Severity severity;
  final String description;
  final String? photoPath;
  final IncidentStatus status;
  final DateTime createdAt;

  const Incident({
    this.id,
    this.referenceNumber,
    required this.latitude,
    required this.longitude,
    required this.victimCount,
    required this.severity,
    required this.description,
    this.photoPath,
    required this.status,
    required this.createdAt,
  });

  Incident copyWith({
    String? id,
    String? referenceNumber,
    IncidentStatus? status,
  }) {
    return Incident(
      id: id ?? this.id,
      referenceNumber: referenceNumber ?? this.referenceNumber,
      latitude: latitude,
      longitude: longitude,
      victimCount: victimCount,
      severity: severity,
      description: description,
      photoPath: photoPath,
      status: status ?? this.status,
      createdAt: createdAt,
    );
  }

  Map<String, dynamic> toJson() => {
        'lat': latitude,
        'lng': longitude,
        'victim_count': victimCount,
        'severity': severity.apiValue,
        'description': description,
        'created_at': createdAt.toIso8601String(),
      };

  factory Incident.fromJson(Map<String, dynamic> json) => Incident(
        id: json['id'] as String?,
        referenceNumber: json['reference_number'] as String?,
        latitude: (json['lat'] as num).toDouble(),
        longitude: (json['lng'] as num).toDouble(),
        victimCount: json['victim_count'] as int? ?? 1,
        severity: SeverityX.fromApi(json['severity'] as String? ?? 'minor'),
        description: json['description'] as String? ?? '',
        photoPath: json['photo_path'] as String?,
        status: IncidentStatusX.fromApi(json['status'] as String? ?? 'reported'),
        createdAt: DateTime.tryParse(json['created_at'] as String? ?? '') ?? DateTime.now(),
      );
}
