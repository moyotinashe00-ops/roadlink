import { describe, expect, it, vi } from 'vitest';
import { applyEvent, groupBoard, hospitalState, initialBoard, setAll } from '../src/lib/board.js';
import { etaRemainingSeconds, formatCountdown } from '../src/lib/format.js';
import { ApiError, createApi } from '../src/lib/api.js';
import { incident } from './fixtures.js';

describe('board logic', () => {
  it('groups incidents into incoming / preparing / done by the hospital\'s own state', () => {
    const a = incident({ hospital: { state: 'notified' } });
    const b = incident({ hospital: { state: 'acknowledged' } });
    const c = incident({ hospital: { state: 'admitted' }, status: 'admitted' });
    const d = incident({ hospital: { state: 'acknowledged' }, status: 'closed' });
    const g = groupBoard(setAll(initialBoard, [a, b, c, d]).incidents);
    expect(g.incoming.map((i) => i.id)).toEqual([a.id]);
    expect(g.preparing.map((i) => i.id)).toEqual([b.id]);
    expect(g.done.map((i) => i.id).sort()).toEqual([c.id, d.id].sort());
  });

  it('puts the most severe, then the oldest, first', () => {
    const old = incident({ severity: 'minor', created_at: '2026-01-01T00:00:00Z' });
    const newer = incident({ severity: 'minor', created_at: '2026-01-02T00:00:00Z' });
    const crit = incident({ severity: 'critical', created_at: '2026-01-03T00:00:00Z' });
    const g = groupBoard(setAll(initialBoard, [newer, crit, old]).incidents);
    expect(g.incoming.map((i) => i.id)).toEqual([crit.id, old.id, newer.id]);
  });

  it('applies live upserts and removals', () => {
    const a = incident();
    let s = applyEvent(initialBoard, { kind: 'upsert', incident: a });
    expect(Object.keys(s.incidents)).toEqual([a.id]);
    s = applyEvent(s, { kind: 'upsert', incident: { ...a, victim_count: 9 } });
    expect(s.incidents[a.id].victim_count).toBe(9);
    s = applyEvent(s, { kind: 'remove', id: a.id });
    expect(s.incidents).toEqual({});
  });

  it('reports no hospital state for an incident not assigned to a hospital', () => {
    expect(hospitalState({ assignment: { hospital: null } })).toBeNull();
  });
});

describe('ETA countdown', () => {
  const assigned = '2026-01-01T10:00:00.000Z';
  const start = new Date(assigned).getTime();
  it('counts down from notification time', () => {
    expect(etaRemainingSeconds({ eta_minutes: 10, assigned_at: assigned }, start + 60000)).toBe(540);
  });
  it('goes negative once overdue', () => {
    expect(etaRemainingSeconds({ eta_minutes: 5, assigned_at: assigned }, start + 6 * 60000)).toBe(-60);
  });
  it('is null when there is nothing to count', () => {
    expect(etaRemainingSeconds({ eta_minutes: null, assigned_at: assigned }, start)).toBeNull();
    expect(etaRemainingSeconds(null, start)).toBeNull();
  });
  it('formats mm:ss and marks overdue with +', () => {
    expect(formatCountdown(125)).toBe('02:05');
    expect(formatCountdown(-61)).toBe('+01:01');
  });
});

describe('api client', () => {
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body });

  it('sends the bearer token and JSON body, and returns parsed data', async () => {
    const fetchImpl = vi.fn(async () => res(200, { is_available: true }));
    const api = createApi({ baseUrl: 'http://x', getToken: () => 'tok', fetchImpl });
    await api.updateCapacity(3, 6);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://x/api/v1/hospitals/me/capacity');
    expect(init.method).toBe('PATCH');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ trauma_bays_free: 3, trauma_bays_total: 6 });
  });

  it('surfaces the server error code and message', async () => {
    const fetchImpl = async () => res(409, { error: { code: 'BAD_STATE', message: 'Already acknowledged' } });
    const api = createApi({ baseUrl: 'http://x', getToken: () => 'tok', fetchImpl });
    await expect(api.acknowledge('1')).rejects.toMatchObject({ status: 409, code: 'BAD_STATE', message: 'Already acknowledged' });
  });

  it('maps a network failure to a friendly NETWORK error', async () => {
    const api = createApi({ baseUrl: 'http://x', fetchImpl: async () => { throw new TypeError('failed'); } });
    await expect(api.hospitals()).rejects.toBeInstanceOf(ApiError);
    await expect(api.hospitals()).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('signs out on 401 only when a token was sent (a wrong password is not a session expiry)', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = async () => res(401, { error: { code: 'UNAUTHORIZED', message: 'nope' } });
    await createApi({ baseUrl: 'http://x', getToken: () => 'tok', onUnauthorized, fetchImpl }).hospitals().catch(() => {});
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await createApi({ baseUrl: 'http://x', getToken: () => null, onUnauthorized, fetchImpl }).login('a', 'b').catch(() => {});
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('handles 204 responses', async () => {
    const api = createApi({ baseUrl: 'http://x', getToken: () => 't', fetchImpl: async () => ({ ok: true, status: 204 }) });
    await expect(api.acknowledge('1')).resolves.toBeNull();
  });
});
