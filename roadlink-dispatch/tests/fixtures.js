// A staff-view incident, as the API returns it to a dispatcher.
export const incident = (over = {}) => ({
  id: 'inc-1', reference_number: 'RL-2600001', lat: -17.83, lng: 31.05, location_accuracy: 'gps', location_label: null,
  victim_count: 2, severity: 'serious', description: 'Two cars collided', hazard_notes: null, has_photo: false,
  report_count: 1, reporter_phone: '+263 77 123 4567', case_reference: null,
  status: 'policeNotified', created_at: '2026-10-18T08:00:00.000Z', updated_at: '2026-10-18T08:00:05.000Z', closed_at: null,
  assignment: { police: { unit_id: 'pu-1', name: 'Harare Central Traffic', state: 'notified' }, ambulance: null, hospital: null },
  ...over,
});

export const withAmbulance = (state = 'assigned', over = {}) => incident({
  status: 'ambulanceAssigned',
  assignment: {
    police: { unit_id: 'pu-1', name: 'Harare Central Traffic', state: 'accepted' },
    ambulance: { ambulance_id: 'amb-1', plate_number: 'ADX-1001', state, eta_minutes: 6 },
    hospital: null,
  },
  ...over,
});

export const recommendations = () => ({
  ambulances: [
    { id: 'amb-1', plate_number: 'ADX-1001', provider: 'City of Harare', distance_m: 850, eta_minutes: 3, location_stale: false },
    { id: 'amb-2', plate_number: 'ADX-1002', provider: 'City of Harare', distance_m: 4200, eta_minutes: 9, location_stale: true },
  ],
  hospitals: [
    { id: 'h-1', name: 'Parirenyatwa Group of Hospitals', contact_number: '+263 4 791631', trauma_bays_free: 5, trauma_bays_total: 8, has_capacity: true, distance_m: 2100, eta_minutes: 8, capacity_stale: false },
    { id: 'h-2', name: 'Avenues Clinic', contact_number: '+263 4 251515', trauma_bays_free: 0, trauma_bays_total: 4, has_capacity: false, distance_m: 1300, eta_minutes: 5, capacity_stale: true },
  ],
});
