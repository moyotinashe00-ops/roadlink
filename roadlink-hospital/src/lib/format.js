export const SEVERITY = {
  minor:    { label: 'Minor',      tone: 'ok' },
  serious:  { label: 'Serious',    tone: 'warn' },
  critical: { label: 'Critical',   tone: 'crit' },
  fatal:    { label: 'Fatalities', tone: 'fatal' },
};

export const AMBULANCE_STATE = {
  assigned:     'Dispatched',
  enRoute:      'En route to scene',
  onScene:      'On scene',
  transporting: 'Transporting patient',
  arrived:      'Arrived at hospital',
};

export const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

/**
 * Seconds until the ambulance is due, counted from when the hospital was notified.
 * Returns null when there is no ETA to count down.
 */
export function etaRemainingSeconds(hospital, nowMs) {
  if (!hospital || !hospital.eta_minutes || !hospital.assigned_at) return null;
  const due = new Date(hospital.assigned_at).getTime() + hospital.eta_minutes * 60000;
  return Math.round((due - nowMs) / 1000);
}

export function formatCountdown(seconds) {
  const abs = Math.abs(seconds);
  const mm = String(Math.floor(abs / 60)).padStart(2, '0');
  const ss = String(abs % 60).padStart(2, '0');
  return `${seconds < 0 ? '+' : ''}${mm}:${ss}`;
}

// AVPU scale, as the ambulance crew records it.
export const CONSCIOUSNESS = {
  alert: 'Alert',
  voice: 'Responds to voice',
  pain: 'Responds to pain',
  unresponsive: 'Unresponsive',
};

/**
 * The four vitals the crew records, ready to show. A vital the crew could not measure arrives as null
 * and is shown as an em dash rather than hidden, so staff can see it is missing and not just not shown.
 */
export function vitalsRows(v) {
  const has = (x) => x !== null && x !== undefined;
  return [
    { key: 'pulse', label: 'Pulse', value: has(v.pulse_bpm) ? String(v.pulse_bpm) : '—', unit: has(v.pulse_bpm) ? 'bpm' : '' },
    { key: 'bp', label: 'Blood pressure', value: has(v.systolic_bp) && has(v.diastolic_bp) ? `${v.systolic_bp}/${v.diastolic_bp}` : '—', unit: has(v.systolic_bp) ? 'mmHg' : '' },
    { key: 'spo2', label: 'Oxygen (SpO₂)', value: has(v.spo2_percent) ? String(v.spo2_percent) : '—', unit: has(v.spo2_percent) ? '%' : '' },
    { key: 'avpu', label: 'Consciousness', value: has(v.consciousness) ? (CONSCIOUSNESS[v.consciousness] || v.consciousness) : '—', unit: '' },
  ];
}
