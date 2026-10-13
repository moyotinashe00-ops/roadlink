// Pure board logic: easy to test, no React in here.

const RANK = { critical: 3, fatal: 3, serious: 2, minor: 1 };

export const initialBoard = { incidents: {} };

export function setAll(state, list) {
  return { ...state, incidents: Object.fromEntries(list.map((i) => [i.id, i])) };
}

export function applyEvent(state, evt) {
  if (evt.kind === 'remove') {
    const { [evt.id]: _gone, ...rest } = state.incidents;
    return { ...state, incidents: rest };
  }
  return { ...state, incidents: { ...state.incidents, [evt.incident.id]: evt.incident } };
}

/** The hospital's own state for an incident (notified | acknowledged | admitted), or null. */
export const hospitalState = (i) => (i.assignment && i.assignment.hospital ? i.assignment.hospital.state : null);

const bySeverityThenAge = (a, b) =>
  (RANK[b.severity] || 0) - (RANK[a.severity] || 0) || new Date(a.created_at) - new Date(b.created_at);

export function groupBoard(incidents) {
  const all = Object.values(incidents);
  const live = all.filter((i) => i.status !== 'closed');
  return {
    incoming: live.filter((i) => hospitalState(i) === 'notified').sort(bySeverityThenAge),
    preparing: live.filter((i) => hospitalState(i) === 'acknowledged').sort(bySeverityThenAge),
    // admitted patients, and closed incidents that this hospital received
    done: all.filter((i) => hospitalState(i) === 'admitted' || i.status === 'closed')
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 15),
  };
}
