// Response shapes. Citizens get a minimal "public" view; staff get the full incident.
// The public view's field names are exactly what the Flutter app's Incident.fromJson reads.

const iso = (v) => (v ? new Date(v).toISOString() : null);

function publicView(r) {
  return {
    id: r.id,
    reference_number: r.reference_number,
    lat: r.lat,
    lng: r.lng,
    location_accuracy: r.location_accuracy,
    victim_count: r.victim_count,
    severity: r.severity,
    description: r.description,
    status: r.status,
    created_at: iso(r.created_at),
  };
}

/** audience: 'dispatcher' (sees reporter phone) or anything else (phone withheld). */
function staffView(r, audience) {
  return {
    ...publicView(r),
    location_label: r.location_label,
    verified_victim_count: r.verified_victim_count,
    hazard_notes: r.hazard_notes,
    has_photo: r.has_photo,
    source: r.source,
    report_count: r.report_count,
    reporter_phone: audience === 'dispatcher' ? r.reporter_phone : undefined,
    updated_at: iso(r.updated_at),
    closed_at: iso(r.closed_at),
    case_reference: r.case_reference || null,
    assignment: {
      police: r.police_unit_id ? { unit_id: r.police_unit_id, name: r.police_unit_name, state: r.police_state } : null,
      ambulance: r.ambulance_id
        ? { ambulance_id: r.ambulance_id, plate_number: r.ambulance_plate, state: r.ambulance_state, eta_minutes: r.ambulance_eta_minutes, assigned_at: iso(r.ambulance_assigned_at) }
        : null,
      hospital: r.hospital_id
        ? {
          hospital_id: r.hospital_id, name: r.hospital_name, state: r.hospital_state, eta_minutes: r.hospital_eta_minutes,
          assigned_at: iso(r.hospital_assigned_at), phone: r.hospital_phone, lat: r.hospital_lat, lng: r.hospital_lng,
        }
        : null,
    },
  };
}

module.exports = { publicView, staffView };
