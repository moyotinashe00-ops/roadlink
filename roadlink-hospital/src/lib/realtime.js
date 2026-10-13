import { io } from 'socket.io-client';

/**
 * Live feed from RoadLink Core. The server only sends this hospital the incidents assigned to it.
 * onEvent receives { kind: 'upsert', incident, event } or { kind: 'remove', id }.
 * onStatus receives 'online' | 'offline' | 'expired'.
 */
export function connectRealtime({ baseUrl, token, onEvent, onStatus }) {
  const socket = io(baseUrl, { auth: { token }, reconnectionDelayMax: 5000 });

  socket.on('connect', () => onStatus('online'));
  socket.on('disconnect', () => onStatus('offline'));
  socket.on('connect_error', (err) => onStatus(err && err.message === 'unauthorized' ? 'expired' : 'offline'));
  socket.on('auth:expired', () => onStatus('expired'));

  const upsert = (p) => onEvent({ kind: 'upsert', incident: p.incident, event: p.event });
  socket.on('incident:new', upsert);
  socket.on('incident:update', upsert);
  socket.on('incident:unassigned', (p) => onEvent({ kind: 'remove', id: p.incident_id }));

  return { close: () => socket.close() };
}
