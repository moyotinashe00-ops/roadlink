import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { applyEvent, initialBoard, setAll } from './board.js';
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

/**
 * Keeps the board in sync: initial load, live Socket.IO events, and a polling fallback while the
 * live connection is down (so a dropped socket delays updates but never loses them — SRS §7.3).
 */
export function useBoard({ api, baseUrl, token, onIncoming, onAuthLost }) {
  const [board, dispatch] = useReducer(reducer, initialBoard);
  const [live, setLive] = useState('connecting'); // connecting | online | offline
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const cb = useRef({ onIncoming, onAuthLost });
  useEffect(() => { cb.current = { onIncoming, onAuthLost }; });

  const refresh = useCallback(async () => {
    try {
      dispatch({ type: 'set', list: await api.listIncidents('all', 100) });
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const rt = connectRealtime({
      baseUrl, token,
      onEvent: (evt) => {
        dispatch({ type: 'event', evt });
        if (evt.kind === 'upsert' && evt.event === 'hospital_notified') cb.current.onIncoming?.(evt.incident);
      },
      onStatus: (s) => {
        if (s === 'expired') return cb.current.onAuthLost?.();
        setLive(s);
        if (s === 'online') refresh(); // catch up on anything missed while disconnected
      },
    });
    return () => rt.close();
  }, [baseUrl, token, refresh]);

  useEffect(() => {
    if (live === 'online') return undefined;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [live, refresh]);

  return { board, live, loading, error, refresh };
}
