let n = 0;
/** A staff-view incident as RoadLink Core returns it to the receiving hospital. */
export function incident(over = {}) {
  n += 1;
  const { hospital = {}, ambulance = {}, police = null, ...rest } = over;
  return {
    id: `inc-${n}`, reference_number: `RL-26${String(n).padStart(5, '0')}`,
    lat: -17.83, lng: 31.05, location_accuracy: 'gps', victim_count: 2, severity: 'serious',
    description: 'Two cars collided', status: 'hospitalNotified', created_at: new Date(Date.now() - 600000).toISOString(),
    updated_at: new Date().toISOString(), verified_victim_count: null, hazard_notes: null, report_count: 1,
    assignment: {
      police,
      ambulance: { ambulance_id: 'a1', plate_number: 'ADX-1001', state: 'enRoute', eta_minutes: 4, assigned_at: new Date().toISOString(), ...ambulance },
      hospital: { hospital_id: 'h1', name: 'Harare Central Hospital', state: 'notified', eta_minutes: 10, assigned_at: new Date().toISOString(), phone: '+2634', lat: -17.84, lng: 31.03, ...hospital },
    },
    ...rest,
  };
}
