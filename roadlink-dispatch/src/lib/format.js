export const SEVERITY = {
  minor:    { label: 'Minor',      tone: 'ok' },
  serious:  { label: 'Serious',    tone: 'warn' },
  critical: { label: 'Critical',   tone: 'crit' },
  fatal:    { label: 'Fatalities', tone: 'fatal' },
};

// The order a dispatcher works in: critical first, then serious, fatalities (nobody to rush, but the scene needs police), minor.
export const PRIORITY = { critical: 0, serious: 1, fatal: 2, minor: 3 };

export const STATUS = {
  reported: 'Reported',
  policeNotified: 'Police alerted',
  policeOnScene: 'Police on scene',
  ambulanceAssigned: 'Ambulance assigned',
  ambulanceEnRoute: 'Ambulance en route',
  ambulanceOnScene: 'Ambulance on scene',
  transporting: 'Transporting',
  hospitalNotified: 'Hospital notified',
  admitted: 'Admitted',
  closed: 'Closed',
};

export const POLICE_STATE = { notified: 'Alerted', accepted: 'Accepted', onScene: 'On scene', cleared: 'Cleared' };
export const AMBULANCE_STATE = {
  assigned: 'Dispatched', enRoute: 'En route', onScene: 'On scene', transporting: 'Transporting', arrived: 'At hospital',
};
export const HOSPITAL_STATE = { notified: 'Notified', acknowledged: 'Preparing', admitted: 'Admitted' };

// Once the crew is on scene or has a patient, replacing the ambulance would strand them (the server enforces this too).
export const COMMITTED = ['onScene', 'transporting', 'arrived'];

export const OUTCOMES = [
  { value: 'completed', label: 'Completed', hint: 'The hospital admitted the patient' },
  { value: 'no_transport', label: 'No transport', hint: 'Nobody went to hospital, for example a fatality' },
  { value: 'false_alarm', label: 'False alarm', hint: 'There was no accident' },
  { value: 'cancelled', label: 'Cancelled', hint: 'Stopped for another reason' },
];

export const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

/** "just now", "4 min", "1 h 05 min" */
export function ageLabel(iso, nowMs) {
  if (!iso) return '';
  const mins = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
}

export function distanceLabel(m) {
  if (m == null) return '';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
