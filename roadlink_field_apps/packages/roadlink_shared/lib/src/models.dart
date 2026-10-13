import 'package:flutter/material.dart';
import 'theme.dart';

enum FieldRole { police, ambulance }

extension FieldRoleX on FieldRole {
  /// The role string RoadLink Core uses.
  String get apiRole => name;
}

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
        Severity.fatal => const Color(0xFFB3122A),
      };
  static Severity fromApi(String? v) =>
      Severity.values.firstWhere((s) => s.name == v, orElse: () => Severity.minor);
}

/// Human labels for the headline incident status strings RoadLink Core sends.
String incidentStatusLabel(String status) => switch (status) {
      'reported' => 'Reported',
      'policeNotified' => 'Police alerted',
      'policeOnScene' => 'Police on scene',
      'ambulanceAssigned' => 'Ambulance assigned',
      'ambulanceEnRoute' => 'Ambulance en route',
      'ambulanceOnScene' => 'Ambulance on scene',
      'transporting' => 'Transporting patient',
      'hospitalNotified' => 'Hospital notified',
      'admitted' => 'Patient admitted',
      'closed' => 'Closed',
      _ => status,
    };

double? _d(dynamic v) => v is num ? v.toDouble() : null;
int? _i(dynamic v) => v is num ? v.toInt() : null;
DateTime? _dt(dynamic v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

class PoliceAssignment {
  final String unitId;
  final String name;
  final String? state; // notified | accepted | onScene | cleared
  const PoliceAssignment({required this.unitId, required this.name, this.state});

  factory PoliceAssignment.fromJson(Map<String, dynamic> j) => PoliceAssignment(
        unitId: j['unit_id'] as String,
        name: (j['name'] as String?) ?? 'Police unit',
        state: j['state'] as String?,
      );
}

class AmbulanceAssignment {
  final String ambulanceId;
  final String plate;
  final String? state; // assigned | enRoute | onScene | transporting | arrived
  final int? etaMinutes;
  final DateTime? assignedAt;
  const AmbulanceAssignment({required this.ambulanceId, required this.plate, this.state, this.etaMinutes, this.assignedAt});

  factory AmbulanceAssignment.fromJson(Map<String, dynamic> j) => AmbulanceAssignment(
        ambulanceId: j['ambulance_id'] as String,
        plate: (j['plate_number'] as String?) ?? 'Ambulance',
        state: j['state'] as String?,
        etaMinutes: _i(j['eta_minutes']),
        assignedAt: _dt(j['assigned_at']),
      );
}

class HospitalAssignment {
  final String hospitalId;
  final String name;
  final String? state; // notified | acknowledged | admitted
  final int? etaMinutes;
  final String? phone;
  final double? lat;
  final double? lng;
  const HospitalAssignment({required this.hospitalId, required this.name, this.state, this.etaMinutes, this.phone, this.lat, this.lng});

  bool get hasLocation => lat != null && lng != null;

  factory HospitalAssignment.fromJson(Map<String, dynamic> j) => HospitalAssignment(
        hospitalId: j['hospital_id'] as String,
        name: (j['name'] as String?) ?? 'Hospital',
        state: j['state'] as String?,
        etaMinutes: _i(j['eta_minutes']),
        phone: j['phone'] as String?,
        lat: _d(j['lat']),
        lng: _d(j['lng']),
      );
}

class Incident {
  final String id;
  final String referenceNumber;
  final double lat;
  final double lng;
  final String locationAccuracy; // gps | approximate
  final String? locationLabel;
  final Severity severity;
  final int victimCount;
  final int? verifiedVictimCount;
  final String description;
  final String? hazardNotes;
  final String status;
  final String? caseReference;
  final DateTime? createdAt;
  final PoliceAssignment? police;
  final AmbulanceAssignment? ambulance;
  final HospitalAssignment? hospital;

  const Incident({
    required this.id,
    required this.referenceNumber,
    required this.lat,
    required this.lng,
    required this.locationAccuracy,
    this.locationLabel,
    required this.severity,
    required this.victimCount,
    this.verifiedVictimCount,
    required this.description,
    this.hazardNotes,
    required this.status,
    this.caseReference,
    this.createdAt,
    this.police,
    this.ambulance,
    this.hospital,
  });

  /// Police-confirmed count wins over the citizen's estimate.
  int get patients => verifiedVictimCount ?? victimCount;
  bool get isClosed => status == 'closed';
  bool get isApproximate => locationAccuracy == 'approximate';

  factory Incident.fromJson(Map<String, dynamic> j) {
    final a = (j['assignment'] as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};
    Map<String, dynamic>? sub(String k) => (a[k] as Map?)?.cast<String, dynamic>();
    final p = sub('police');
    final am = sub('ambulance');
    final h = sub('hospital');
    return Incident(
      id: j['id'] as String,
      referenceNumber: (j['reference_number'] as String?) ?? '',
      lat: _d(j['lat']) ?? 0,
      lng: _d(j['lng']) ?? 0,
      locationAccuracy: (j['location_accuracy'] as String?) ?? 'gps',
      locationLabel: j['location_label'] as String?,
      severity: SeverityX.fromApi(j['severity'] as String?),
      victimCount: _i(j['victim_count']) ?? 1,
      verifiedVictimCount: _i(j['verified_victim_count']),
      description: (j['description'] as String?) ?? '',
      hazardNotes: j['hazard_notes'] as String?,
      status: (j['status'] as String?) ?? 'reported',
      caseReference: j['case_reference'] as String?,
      createdAt: _dt(j['created_at']),
      police: p == null ? null : PoliceAssignment.fromJson(p),
      ambulance: am == null ? null : AmbulanceAssignment.fromJson(am),
      hospital: h == null ? null : HospitalAssignment.fromJson(h),
    );
  }
}

class AppUser {
  final String id;
  final String name;
  final String role;
  final String? policeUnitId;
  final String? ambulanceId;

  const AppUser({required this.id, required this.name, required this.role, this.policeUnitId, this.ambulanceId});

  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
        id: j['id'] as String,
        name: (j['name'] as String?) ?? '',
        role: j['role'] as String,
        policeUnitId: j['police_unit_id'] as String?,
        ambulanceId: j['ambulance_id'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'role': role,
        'police_unit_id': policeUnitId,
        'ambulance_id': ambulanceId,
      };
}

class TimelineEntry {
  final String event;
  final String actor;
  final String? note;
  final DateTime? at;
  const TimelineEntry({required this.event, required this.actor, this.note, this.at});

  factory TimelineEntry.fromJson(Map<String, dynamic> j) => TimelineEntry(
        event: (j['event'] as String?) ?? '',
        actor: (j['actor_name'] as String?) ?? (j['actor_role'] as String?) ?? '',
        note: j['note'] as String?,
        at: _dt(j['created_at']),
      );
}

/// The unit's/vehicle's own on-duty record (`GET /police-units/me`, `GET /ambulances/me`).
class MyResource {
  final String id;
  final String label; // unit name or plate number
  final bool isAvailable;
  const MyResource({required this.id, required this.label, required this.isAvailable});

  factory MyResource.fromJson(Map<String, dynamic> j) => MyResource(
        id: j['id'] as String,
        label: (j['plate_number'] as String?) ?? (j['name'] as String?) ?? '',
        isAvailable: j['is_available'] == true,
      );
}
