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
