import { describe, expect, it, vi } from 'vitest';
import { applyEvent, initialBoard, moveResource, needs, needsAction, setAll, splitBoard } from '../src/lib/board.js';
import { ageLabel, distanceLabel } from '../src/lib/format.js';
import { ApiError, createApi } from '../src/lib/api.js';
import { incident, withAmbulance } from './fixtures.js';

describe('board ordering', () => {
  const list = [
    incident({ id: 'a', severity: 'minor', created_at: '2026-10-18T08:00:00Z' }),
    incident({ id: 'b', severity: 'critical', created_at: '2026-10-18T08:30:00Z' }),
    incident({ id: 'c', severity: 'critical', created_at: '2026-10-18T08:10:00Z' }),
    incident({ id: 'd', severity: 'serious', created_at: '2026-10-18T07:00:00Z' }),
    incident({ id: 'e', severity: 'fatal', created_at: '2026-10-18T07:30:00Z' }),
    incident({ id: 'x', status: 'closed', closed_at: '2026-10-18T09:00:00Z' }),
    incident({ id: 'y', status: 'closed', closed_at: '2026-10-18T10:00:00Z' }),
  ];

  it('puts critical first, then serious, fatalities, minor; oldest first within a level', () => {
    const { open } = splitBoard(setAll(initialBoard, list));
    expect(open.map((i) => i.id)).toEqual(['c', 'b', 'd', 'e', 'a']);
  });

  it('lists closed incidents most recently closed first and keeps them out of the open list', () => {
    const { open, closed } = splitBoard(setAll(initialBoard, list));
    expect(closed.map((i) => i.id)).toEqual(['y', 'x']);
    expect(open.some((i) => i.status === 'closed')).toBe(false);
  });

  it('applies a live event, and ignores one older than what it already holds', () => {
    let state = setAll(initialBoard, [incident({ updated_at: '2026-10-18T08:10:00Z', status: 'ambulanceAssigned' })]);
    state = applyEvent(state, { incident: incident({ updated_at: '2026-10-18T08:05:00Z', status: 'policeNotified' }) });
    expect(state.byId['inc-1'].status).toBe('ambulanceAssigned');
    state = applyEvent(state, { incident: incident({ updated_at: '2026-10-18T08:20:00Z', status: 'transporting' }) });
    expect(state.byId['inc-1'].status).toBe('transporting');
  });

  it('works out what an incident still needs', () => {
    expect(needs(incident())).toEqual({ police: false, ambulance: true, hospital: false });
    expect(needs(withAmbulance())).toEqual({ police: false, ambulance: false, hospital: true });
    expect(needs(incident({ assignment: { police: null, ambulance: null, hospital: null } })).police).toBe(true);
    expect(needsAction(incident({ status: 'closed' }))).toBe(false);
  });

  it('moves a vehicle when a live position arrives, and ignores unknown kinds', () => {
    const fleet = { ambulances: [{ id: 'amb-1', lat: 1, lng: 1 }], police: [{ id: 'pu-1', lat: 2, lng: 2 }] };
    const moved = moveResource(fleet, { kind: 'ambulance', id: 'amb-1', lat: -17.8, lng: 31.1, at: '2026-10-18T08:00:00Z' });
    expect(moved.ambulances[0]).toMatchObject({ lat: -17.8, lng: 31.1, location_updated_at: '2026-10-18T08:00:00Z' });
    expect(moved.police).toBe(fleet.police);
    expect(moveResource(fleet, { kind: 'boat', id: 'x' })).toBe(fleet);
  });
});

describe('formatting', () => {
  const now = new Date('2026-10-18T09:00:00Z').getTime();
  it('shows ages the way a dispatcher reads them', () => {
    expect(ageLabel('2026-10-18T08:59:40Z', now)).toBe('just now');
    expect(ageLabel('2026-10-18T08:56:00Z', now)).toBe('4 min');
    expect(ageLabel('2026-10-18T07:55:00Z', now)).toBe('1 h 05 min');
  });
  it('shows distances in metres, then kilometres', () => {
    expect(distanceLabel(240)).toBe('240 m');
    expect(distanceLabel(1340)).toBe('1.3 km');
    expect(distanceLabel(null)).toBe('');
  });
});

describe('api client', () => {
  const reply = (status, body) => vi.fn().mockResolvedValue({ status, ok: status < 400, json: async () => body });

  it('sends the token and unwraps lists', async () => {
    const fetchImpl = reply(200, { incidents: [incident()] });
    const api = createApi({ baseUrl: 'http://core', getToken: () => 'tok', fetchImpl });
    expect(await api.listIncidents('all', 50)).toHaveLength(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://core/api/v1/incidents?status=all&limit=50');
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('asks the server to choose when no ambulance is given, and only sends force when needed', async () => {
    const fetchImpl = reply(200, {});
    const api = createApi({ baseUrl: 'http://core', fetchImpl });
    await api.assignAmbulance('i1');
    await api.assignAmbulance('i1', { ambulanceId: 'a1' });
    await api.assignAmbulance('i1', { ambulanceId: 'a1', force: true });
    const bodies = fetchImpl.mock.calls.map(([, o]) => JSON.parse(o.body));
    expect(bodies).toEqual([{}, { ambulance_id: 'a1' }, { ambulance_id: 'a1', force: true }]);
  });

  it('keeps the server error code and message', async () => {
    const api = createApi({ baseUrl: 'http://core', fetchImpl: reply(409, { error: { code: 'AMBULANCE_ON_JOB', message: 'Already on scene' } }) });
    await expect(api.assignAmbulance('i1')).rejects.toMatchObject({ code: 'AMBULANCE_ON_JOB', message: 'Already on scene', status: 409 });
  });

  it('turns a network failure into a clear error', async () => {
    const api = createApi({ baseUrl: 'http://core', fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    await expect(api.listIncidents()).rejects.toBeInstanceOf(ApiError);
    await expect(api.listIncidents()).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('signs the user out when the server rejects their session', async () => {
    const onUnauthorized = vi.fn();
    const api = createApi({ baseUrl: 'http://core', getToken: () => 'old', onUnauthorized, fetchImpl: reply(401, { error: { code: 'UNAUTHORIZED', message: 'Expired' } }) });
    await expect(api.listIncidents()).rejects.toThrow('Expired');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not treat a failed login as an expired session', async () => {
    const onUnauthorized = vi.fn();
    const api = createApi({ baseUrl: 'http://core', onUnauthorized, fetchImpl: reply(401, { error: { code: 'BAD_LOGIN', message: 'Wrong password' } }) });
    await expect(api.login('a', 'b')).rejects.toThrow('Wrong password');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
