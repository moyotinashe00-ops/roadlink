import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { applyEvent, initialBoard, moveResource, setAll } from './board.js';
import { connectRealtime } from './realtime.js';

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function reducer(state, action) {
  if (action.type === 'set') return setAll(state, action.list);
  if (action.type === 'event') return applyEvent(state, action.evt);
  return state;
}

const POLL_MS = 15000;
const FLEET_REFRESH_MS = 1500;

/**
 * Keeps the console in sync: initial load, live Socket.IO events, and a polling fallback while the live
 * connection is down, so a dropped socket delays updates but never loses them.
 */
export function useConsole({ api, baseUrl, token, onNewIncident, onAuthLost }) {
  const [board, dispatch] = useReducer(reducer, initialBoard);
  const [fleet, setFleet] = useState({ ambulances: [], police: [] });
  const [live, setLive] = useState('connecting'); // connecting | online | offline
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const cb = useRef({ onNewIncident, onAuthLost });
  useEffect(() => { cb.current = { onNewIncident, onAuthLost }; });

  const refresh = useCallback(async () => {
    try {
      const [list, ambulances, police] = await Promise.all([api.listIncidents('all', 100), api.ambulances(), api.policeUnits()]);
      dispatch({ type: 'set', list });
      setFleet({ ambulances, police });
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  // Availability of vehicles changes with incident events, so refresh the fleet shortly after one (not on every event).
  const fleetTimer = useRef(null);
  const refreshFleetSoon = useCallback(() => {
    if (fleetTimer.current) return;
    fleetTimer.current = setTimeout(async () => {
      fleetTimer.current = null;
      try {
        const [ambulances, police] = await Promise.all([api.ambulances(), api.policeUnits()]);
        setFleet((f) => ({ ambulances: ambulances.map((a) => f.ambulances.find((o) => o.id === a.id && o.location_updated_at > a.location_updated_at) || a), police }));
      } catch { /* the next poll will catch up */ }
    }, FLEET_REFRESH_MS);
  }, [api]);
  useEffect(() => () => clearTimeout(fleetTimer.current), []);

  useEffect(() => {
    const rt = connectRealtime({
      baseUrl, token,
      onEvent: (evt) => {
        dispatch({ type: 'event', evt });
        if (evt.isNew) cb.current.onNewIncident?.(evt.incident);
        refreshFleetSoon();
      },
      onResource: (p) => setFleet((f) => moveResource(f, p)),
      onCapacity: () => {},
      onStatus: (s) => {
        if (s === 'expired') return cb.current.onAuthLost?.();
        setLive(s);
        if (s === 'online') refresh(); // catch up on anything missed while disconnected
        return undefined;
      },
    });
    return () => rt.close();
  }, [baseUrl, token, refresh, refreshFleetSoon]);

  useEffect(() => {
    if (live === 'online') return undefined;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [live, refresh]);

  /** Put an incident the server just returned (after an assign or close) straight onto the board. */
  const upsert = useCallback((incident) => dispatch({ type: 'event', evt: { incident } }), []);

  return { board, fleet, live, loading, error, refresh, upsert };
}
