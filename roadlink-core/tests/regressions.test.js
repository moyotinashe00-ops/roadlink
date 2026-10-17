// Regression tests for dispatch bugs found in the October 2026 review. Each one failed before its fix.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const svc = require('../src/services/incidentService');

let srv;
let T;
const api = () => srv.request;
const post = (path, token, body) => api().post(path).set(h.auth(token)).send(body || {});
const report = (body) => api().post('/api/v1/incidents').send({ severity: 'serious', victim_count: 2, ...body });
const staffView = async (id) => (await api().get(`/api/v1/incidents/${id}`).set(h.auth(T.dispatcher))).body;
const eventsOf = async (id) => (await h.pool.query('SELECT event FROM status_updates WHERE incident_id = $1', [id])).rows.map((r) => r.event);
const count = async (table) => (await h.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

// Police crews log in as one of two seeded accounts; find the token for whichever unit holds the incident.
async function policeTokenFor(unitId) {
  const { rows } = await h.pool.query('SELECT email FROM users WHERE police_unit_id = $1', [unitId]);
  return rows[0].email === 'police1@roadlink.zw' ? T.police1 : T.police2;
}

before(async () => { srv = await h.startServer(); });
after(async () => { await srv.close(); await h.pool.end(); });
beforeEach(async () => { await h.resetDb(); T = await h.loginAll(srv.request); });

test('simultaneous reports of one crash become one incident and alert one police unit', async () => {
  // Warm the connection pool first: with a cold pool the requests queue up one by one and never truly overlap.
  await Promise.all(Array.from({ length: 10 }, () => h.pool.query('SELECT 1')));
  for (let round = 0; round < 5; round += 1) {
    await h.resetDb();
    const replies = await Promise.all(Array.from({ length: 8 }, () => report({ lat: -17.9, lng: 31.1 })));
    assert.equal(await count('incidents'), 1, `round ${round}: one incident`);
    assert.equal(await count('assignments'), 1, `round ${round}: one police alert`);
    assert.equal(replies.filter((r) => r.status === 201).length, 1, `round ${round}: exactly one report creates it`);
  }
});

test('duplicate merging follows last activity, not creation time', async () => {
  const busy = (await report({ lat: -17.80, lng: 31.00 })).body;
  const quiet = (await report({ lat: -17.50, lng: 31.50 })).body;
  await h.pool.query("UPDATE incidents SET created_at = now() - interval '3 hours', updated_at = now() - interval '1 minute' WHERE id = $1", [busy.id]);
  await h.pool.query("UPDATE incidents SET created_at = now() - interval '3 hours', updated_at = now() - interval '2 hours' WHERE id = $1", [quiet.id]);

  const again = await report({ lat: -17.80, lng: 31.00 });
  assert.equal(again.status, 200);
  assert.equal(again.body.id, busy.id, 'a scene that is still active keeps absorbing reports');

  const fresh = await report({ lat: -17.50, lng: 31.50 });
  assert.equal(fresh.status, 201);
  assert.notEqual(fresh.body.id, quiet.id, 'an incident with no activity for 2 hours is not reused');
});

test('auto-dispatch does not pick an ambulance whose position is hours old', async () => {
  const nearest = (await h.pool.query(
    `SELECT id, plate_number FROM ambulances WHERE is_active AND is_available AND location IS NOT NULL
     ORDER BY location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography LIMIT 1`, [h.CBD.lng, h.CBD.lat])).rows[0];
  await h.pool.query("UPDATE ambulances SET location_updated_at = now() - interval '5 hours' WHERE id = $1", [nearest.id]);
  const inc = (await report({ lat: h.CBD.lat, lng: h.CBD.lng })).body;

  const recs = (await api().get(`/api/v1/incidents/${inc.id}/recommendations`).set(h.auth(T.dispatcher))).body;
  assert.notEqual(recs.ambulances[0].plate_number, nearest.plate_number, 'fresh positions are listed first');
  assert.equal(recs.ambulances[0].location_stale, false);

  const picked = await post(`/api/v1/incidents/${inc.id}/ambulance`, T.dispatcher);
  assert.equal(picked.status, 200);
  assert.notEqual(picked.body.assignment.ambulance.plate_number, nearest.plate_number);
});

test('auto-dispatch still works when every position is stale', async () => {
  await h.pool.query("UPDATE ambulances SET location_updated_at = now() - interval '5 hours'");
  const inc = (await report({ lat: h.CBD.lat, lng: h.CBD.lng })).body;
  const picked = await post(`/api/v1/incidents/${inc.id}/ambulance`, T.dispatcher);
  assert.equal(picked.status, 200, 'a stale ambulance is better than none');
});

test('an ambulance with a patient on board cannot be reassigned unless forced', async () => {
  const inc = (await report({ lat: -17.83, lng: 31.05 })).body;
  const first = (await post(`/api/v1/incidents/${inc.id}/ambulance`, T.dispatcher)).body.assignment.ambulance.plate_number;
  const crew = first === 'ADX-1001' ? T.amb1 : T.amb2;
  for (const status of ['enRoute', 'onScene', 'transporting']) {
    assert.equal((await post(`/api/v1/incidents/${inc.id}/ambulance/status`, crew, { status })).status, 200);
  }

  const refused = await post(`/api/v1/incidents/${inc.id}/ambulance`, T.dispatcher);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'AMBULANCE_ON_JOB');
  const stillBusy = (await h.pool.query('SELECT is_available FROM ambulances WHERE plate_number = $1', [first])).rows[0];
  assert.equal(stillBusy.is_available, false, 'the crew keeps its ambulance');

  const forced = await post(`/api/v1/incidents/${inc.id}/ambulance`, T.dispatcher, { force: true });
  assert.equal(forced.status, 200);
  assert.notEqual(forced.body.assignment.ambulance.plate_number, first);
  assert.ok((await eventsOf(inc.id)).includes('ambulance_reassigned'));
});

test('a police unit that accepts and then declines becomes available again', async () => {
  const inc = (await report({ lat: h.CBD.lat, lng: h.CBD.lng })).body;
  const unitId = (await staffView(inc.id)).assignment.police.unit_id;
  const crew = await policeTokenFor(unitId);

  await post(`/api/v1/incidents/${inc.id}/police/accept`, crew);
  assert.equal((await h.pool.query('SELECT is_available FROM police_units WHERE id = $1', [unitId])).rows[0].is_available, false);

  const declined = await post(`/api/v1/incidents/${inc.id}/police/decline`, crew, { reason: 'vehicle broke down' });
  assert.equal(declined.status, 200);
  assert.equal((await h.pool.query('SELECT is_available FROM police_units WHERE id = $1', [unitId])).rows[0].is_available, true);
  assert.notEqual((await staffView(inc.id)).assignment.police.unit_id, unitId, 'the incident moved to another unit');
});

test('when every police unit has declined the citizen is no longer told police were notified', async () => {
  const inc = (await report({ lat: h.CBD.lat, lng: h.CBD.lng })).body;
  assert.equal((await api().get(`/api/v1/incidents/${inc.id}`)).body.status, 'policeNotified');

  for (let i = 0; i < 6; i += 1) {
    const unitId = ((await staffView(inc.id)).assignment || {}).police?.unit_id;
    if (!unitId) break;
    // Some seeded units have no login account, so act as the unit through the service.
    await svc.policeDecline(inc.id, { id: null, role: 'police', police_unit_id: unitId }, 'busy');
  }
  assert.equal((await api().get(`/api/v1/incidents/${inc.id}`)).body.status, 'reported');
});

test('an unresponsive police unit is escalated, and dispatch is told once when nobody is left', async () => {
  const units = (await h.pool.query('SELECT count(*)::int AS n FROM police_units WHERE is_active AND location IS NOT NULL')).rows[0].n;
  const inc = (await report({ lat: h.CBD.lat, lng: h.CBD.lng })).body;
  const first = (await staffView(inc.id)).assignment.police.unit_id;
  const age = () => h.pool.query("UPDATE assignments SET police_assigned_at = now() - interval '10 minutes' WHERE incident_id = $1", [inc.id]);

  assert.equal(await svc.escalateUnresponsivePolice(), 0, 'a fresh alert is left alone');

  await age();
  assert.equal(await svc.escalateUnresponsivePolice(), 1);
  assert.notEqual((await staffView(inc.id)).assignment.police.unit_id, first, 'the next unit is alerted');

  for (let i = 1; i < units; i += 1) { await age(); await svc.escalateUnresponsivePolice(); }
  assert.equal(await svc.escalateUnresponsivePolice(), 0, 'no repeat once dispatch has been told');

  const events = await eventsOf(inc.id);
  assert.equal(events.filter((e) => e === 'police_escalated').length, units - 1);
  assert.equal(events.filter((e) => e === 'police_unresponsive').length, 1);
});

test('a police unit that answers in time is not escalated', async () => {
  const inc = (await report({ lat: h.CBD.lat, lng: h.CBD.lng })).body;
  const unitId = (await staffView(inc.id)).assignment.police.unit_id;
  await post(`/api/v1/incidents/${inc.id}/police/accept`, await policeTokenFor(unitId));
  await h.pool.query("UPDATE assignments SET police_assigned_at = now() - interval '10 minutes' WHERE incident_id = $1", [inc.id]);

  assert.equal(await svc.escalateUnresponsivePolice(), 0);
  assert.equal((await staffView(inc.id)).assignment.police.unit_id, unitId);
});

test('an incident with no transport (for example a fatality) can be closed without hospital admission', async () => {
  const inc = (await report({ lat: -17.7, lng: 31.2, severity: 'fatal' })).body;

  const completed = await post(`/api/v1/incidents/${inc.id}/close`, T.dispatcher, { outcome: 'completed' });
  assert.equal(completed.status, 409);
  assert.equal(completed.body.error.code, 'NOT_ADMITTED');

  const closed = await post(`/api/v1/incidents/${inc.id}/close`, T.dispatcher, { outcome: 'no_transport', note: 'Scene handed to police' });
  assert.equal(closed.status, 200);
  assert.equal((await api().get(`/api/v1/incidents/${inc.id}`)).body.status, 'closed');
});
