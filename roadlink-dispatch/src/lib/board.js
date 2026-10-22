import { PRIORITY } from './format.js';

// The board is every incident the dispatcher can see, keyed by id. Events and refreshes upsert into it.
export const initialBoard = { byId: {} };

export function setAll(state, list) {
  const byId = {};
  list.forEach((i) => { byId[i.id] = i; });
  return { byId };
}

export function applyEvent(state, { incident }) {
  if (!incident || !incident.id) return state;
  const old = state.byId[incident.id];
  // Ignore an event older than what we already hold (events can arrive out of order after a reconnect).
  if (old && old.updated_at && incident.updated_at && incident.updated_at < old.updated_at) return state;
  return { byId: { ...state.byId, [incident.id]: { ...old, ...incident } } };
}

const time = (iso) => (iso ? new Date(iso).getTime() : 0);

/** Open incidents: most urgent first, oldest first within a level. Closed: most recently closed first. */
export function splitBoard(state) {
  const all = Object.values(state.byId);
  const open = all.filter((i) => i.status !== 'closed')
    .sort((a, b) => (PRIORITY[a.severity] - PRIORITY[b.severity]) || (time(a.created_at) - time(b.created_at)));
  const closed = all.filter((i) => i.status === 'closed')
    .sort((a, b) => time(b.closed_at || b.updated_at) - time(a.closed_at || a.updated_at));
  return { open, closed };
}

/** What still needs the dispatcher's attention on an open incident. */
export function needs(incident) {
  const a = incident.assignment || {};
  return {
    police: !a.police,
    ambulance: !a.ambulance,
    hospital: !!a.ambulance && !a.hospital,
  };
}

export const needsAction = (incident) => {
  const n = needs(incident);
  return incident.status !== 'closed' && (n.police || n.ambulance || n.hospital);
};

/** Move an ambulance or police unit on the fleet list when a live position arrives. */
export function moveResource(fleet, { kind, id, lat, lng, at }) {
  const key = kind === 'ambulance' ? 'ambulances' : kind === 'police' ? 'police' : null;
  if (!key) return fleet;
  return { ...fleet, [key]: fleet[key].map((r) => (r.id === id ? { ...r, lat, lng, location_updated_at: at } : r)) };
}
