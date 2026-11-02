import 'dart:typed_data';

import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Matches SRS §4.1 (CIT-04): a short, predefined severity list.
enum Severity { minor, serious, critical, fatal }

extension SeverityX on Severity {
  String get label => switch (this) {
        Severity.minor => 'Minor',
        Severity.serious => 'Serious',
        Severity.critical => 'Critical',
        Severity.fatal => 'Fatal',
      };

  String get apiValue => name;

  Color get color => switch (this) {
        Severity.minor => AppColors.safe,
        Severity.serious => AppColors.amber,
        Severity.critical => AppColors.alert,
        Severity.fatal => const Color(0xFF6B1F0E),
      };

  IconData get icon => switch (this) {
        Severity.minor => Icons.directions_car_filled_outlined,
        Severity.serious => Icons.warning_amber_rounded,
        Severity.critical => Icons.local_hospital_outlined,
        Severity.fatal => Icons.priority_high_rounded,
      };

  static Severity fromApi(String value) => Severity.values.firstWhere(
        (s) => s.name == value,
        orElse: () => throw FormatException('Unknown incident severity "$value".'),
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
        orElse: () => throw FormatException('Unknown incident status "$value".'),
      );
}

/// A stage the incident has really passed through, and when (taken from the server's timeline).
class IncidentMilestone {
  final IncidentStatus status;
  final DateTime? at;
  const IncidentMilestone({required this.status, this.at});
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

  /// The chosen photo held in memory. Uploaded as bytes so the same code works in a browser,
  /// where there is no file path to read. Never sent as JSON.
  final Uint8List? photoBytes;
  final IncidentStatus status;
  final DateTime createdAt;

  /// How a closed incident ended: completed | no_transport | false_alarm | cancelled (null while open).
  final String? outcome;

  /// The stages that really happened, in the order they happened. [status] alone cannot show this: it only
  /// moves forward by rank, so it cannot say that the hospital was notified before the ambulance arrived,
  /// and "closed" does not mean anyone was admitted.
  final List<IncidentMilestone> milestones;

  const Incident({
    this.id,
    this.referenceNumber,
    required this.latitude,
    required this.longitude,
    required this.victimCount,
    required this.severity,
    required this.description,
    this.photoPath,
    this.photoBytes,
    required this.status,
    required this.createdAt,
    this.outcome,
    this.milestones = const [],
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
      photoBytes: photoBytes,
      status: status ?? this.status,
      createdAt: createdAt,
      outcome: outcome,
      milestones: milestones,
    );
  }

  Map<String, dynamic> toJson() => {
        'lat': latitude,
        'lng': longitude,
        'victim_count': victimCount,
        'severity': severity.apiValue,
        'description': description,
      };

  factory Incident.fromJson(Map<String, dynamic> json) {
    final createdAtValue = json['created_at'];
    final createdAt = createdAtValue == null
        ? DateTime.now()
        : DateTime.parse(createdAtValue as String);
    final victimCountValue = json['victim_count'];
    final milestones = <IncidentMilestone>[];
    for (final m in (json['milestones'] as List?) ?? const []) {
      if (m is! Map) continue;
      IncidentStatus? stage;
      for (final candidate in IncidentStatus.values) {
        if (candidate.name == m['status']) stage = candidate;
      }
      if (stage == null) continue; // a stage this app version does not know: skip it, do not crash
      final at = m['at'];
      milestones.add(IncidentMilestone(status: stage, at: at is String ? DateTime.tryParse(at)?.toLocal() : null));
    }
    return Incident(
      id: json['id'] as String?,
      referenceNumber: json['reference_number'] as String?,
      latitude: (json['lat'] as num).toDouble(),
      longitude: (json['lng'] as num).toDouble(),
      victimCount: victimCountValue == null
          ? 1
          : (victimCountValue as num).toInt(),
      severity: SeverityX.fromApi(json['severity'] as String),
      description: json['description'] as String? ?? '',
      photoPath: json['photo_path'] as String?,
      status: IncidentStatusX.fromApi(json['status'] as String),
      createdAt: createdAt,
      outcome: json['outcome'] as String?,
      milestones: milestones,
    );
  }
}

/// What to tell the citizen about how things stand. A closed incident does not mean a patient was admitted.
extension IncidentWordingX on Incident {
  /// Short status line. For a closed incident it says how it ended.
  String get statusLabel => status == IncidentStatus.closed ? IncidentWordingX.closedLabel(outcome) : status.label;

  /// The closing sentence under the timeline, or null while the incident is still open.
  String? get closingMessage {
    if (status == IncidentStatus.closed) {
      return switch (outcome) {
        'completed' => 'Patient admitted and incident closed. Thank you for reporting.',
        'no_transport' => 'Incident closed: no one needed to be taken to hospital. Thank you for reporting.',
        'false_alarm' => 'Incident closed: it was a false alarm. Thank you for reporting.',
        'cancelled' => 'Incident closed: the report was cancelled. Thank you for reporting.',
        _ => 'Incident closed. Thank you for reporting.',
      };
    }
    if (status == IncidentStatus.admitted) return 'Patient admitted. Thank you for reporting.';
    return null;
  }

  static String closedLabel(String? outcome) => switch (outcome) {
        'completed' => 'Closed: patient admitted',
        'no_transport' => 'Closed: no transport needed',
        'false_alarm' => 'Closed: false alarm',
        'cancelled' => 'Closed: report cancelled',
        _ => 'Closed',
      };
}
