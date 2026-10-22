import { io } from 'socket.io-client';

/**
 * Live feed from RoadLink Core. Dispatchers receive every incident and every vehicle position.
 *   onEvent    { incident, event, isNew }   a new or changed incident
 *   onResource { kind, id, lat, lng, at }   an ambulance or police unit moved
 *   onCapacity ()                           a hospital changed its trauma-bay numbers
 *   onStatus   'online' | 'offline' | 'expired'
 */
export function connectRealtime({ baseUrl, token, onEvent, onResource = () => {}, onCapacity = () => {}, onStatus }) {
  const socket = io(baseUrl, { auth: { token }, reconnectionDelayMax: 5000 });

  socket.on('connect', () => onStatus('online'));
  socket.on('disconnect', () => onStatus('offline'));
  socket.on('connect_error', (err) => onStatus(err && err.message === 'unauthorized' ? 'expired' : 'offline'));
  socket.on('auth:expired', () => onStatus('expired'));

  socket.on('incident:new', (p) => onEvent({ incident: p.incident, event: p.event, isNew: true }));
  socket.on('incident:update', (p) => onEvent({ incident: p.incident, event: p.event, isNew: false }));
  socket.on('resource:location', (p) => onResource(p));
  socket.on('hospital:capacity', () => onCapacity());

  return { close: () => socket.close() };
}
