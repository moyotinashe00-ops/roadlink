// sessionStorage (not localStorage): a shared ED-desk PC should not stay signed in after the tab closes.
const KEY = 'roadlink.hospital.session';

export function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(KEY)) || null; } catch { return null; }
}
export function saveSession(s) {
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
export function clearSession() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

const MUTE_KEY = 'roadlink.hospital.muted';
export const loadMuted = () => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } };
export const saveMuted = (m) => { try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* ignore */ } };
