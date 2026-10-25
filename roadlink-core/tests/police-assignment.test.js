// A dispatcher can alert a police unit by hand (POST /incidents/:id/police).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let srv;
let T;
const api = () => srv.request;
const post = (path, token, body) => api().post(path).set(h.auth(token)).send(body || {});
const report = (body) => api().post('/api/v1/incidents').send({ severity: 'serious', victim_count: 2, ...body });
const staffView = async (id) => (await api().get(`/api/v1/incidents/${id}`).set(h.auth(T.dispatcher))).body;
const events = async (id) => (await h.pool.query('SELECT event FROM status_updates WHERE incident_id = $1', [id])).rows.map((r) => r.event);

before(async () => { srv = await h.startServer(); });
after(async () => { await srv.close(); await h.pool.end(); });
beforeEach(async () => { await h.resetDb(); T = await h.loginAll(srv.request); });

test('the recommendations list police units, available ones first', async () => {
  const inc = (await report({ lat: h.CBD.lat, lng: h.CBD.lng })).body;
  const recs = (await api().get(`/api/v1/incidents/${inc.id}/recommendations`).set(h.auth(T.dispatcher))).body;
  assert.ok(recs.police.length >= 2);
  for (const f of ['id', 'name', 'is_available', 'distance_m', 'eta_minutes', 'location_stale']) assert.ok(f in recs.police[0], `police recommendation needs ${f}`);

  const firstUnit = (await staffView(inc.id)).assignment.police.unit_id;
  await h.pool.query('UPDATE police_units SET is_available = FALSE WHERE id = $1', [firstUnit]);
  const again = (await api().get(`/api/v1/incidents/${inc.id}/recommendations`).set(h.auth(T.dispatcher))).body;
  assert.equal(again.police[0].is_available, true, 'a busy unit is listed after the available ones');
  assert.equal(again.police[again.police.length - 1].is_available, false);
});

test('a dispatcher alerts the unit they choose, and the unit passed over is not offered the incident again', async () => {
  const inc = (await report({ lat: h.CBD.lat, lng: h.CBD.lng })).body;
  const first = (await staffView(inc.id)).assignment.police.unit_id;
  const recs = (await api().get(`/api/v1/incidents/${inc.id}/recommendations`).set(h.auth(T.dispatcher))).body;
  const other = recs.police.find((p) => p.id !== first);

  const res = await post(`/api/v1/incidents/${inc.id}/police`, T.dispatcher, { police_unit_id: other.id });
  assert.equal(res.status, 200);
  assert.equal(res.body.assignment.police.unit_id, other.id);
  assert.equal(res.body.assignment.police.state, 'notified');
  assert.ok((await events(inc.id)).includes('police_assigned'));

  const passedOver = (await h.pool.query('SELECT declined_police_unit_ids AS d FROM assignments WHERE incident_id = $1', [inc.id])).rows[0].d;
  assert.ok(passedOver.includes(first));
});

test('without a unit given, the nearest other unit is alerted', async () => {
  const inc = (await report({ lat: h.CBD.lat, lng: h.CBD.lng })).body;
  const first = (await staffView(inc.id)).assignment.police.unit_id;
  const res = await post(`/api/v1/incidents/${inc.id}/police`, T.dispatcher);
  assert.equal(res.status, 200);
  assert.notEqual(res.body.assignment.police.unit_id, first);
});

test('it refuses to take a unit that has already accepted or arrived', async () => {
  const inc = (await report({ lat: h.CBD.lat, lng: h.CBD.lng })).body;
  await h.pool.query("UPDATE assignments SET police_state = 'accepted' WHERE incident_id = $1", [inc.id]);
  let res = await post(`/api/v1/incidents/${inc.id}/police`, T.dispatcher);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'POLICE_ON_JOB');

  await h.pool.query("UPDATE assignments SET police_state = 'onScene' WHERE incident_id = $1", [inc.id]);
  res = await post(`/api/v1/incidents/${inc.id}/police`, T.dispatcher);
  assert.equal(res.body.error.code, 'POLICE_ON_JOB');
});

test('it refuses to alert the unit that is already alerted', async () => {
  const inc = (await report({ lat: h.CBD.lat, lng: h.CBD.lng })).body;
  const first = (await staffView(inc.id)).assignment.police.unit_id;
  const res = await post(`/api/v1/incidents/${inc.id}/police`, T.dispatcher, { police_unit_id: first });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'ALREADY_ASSIGNED');
});

test('it fills the gap when automatic alerting found nobody, and the citizen sees police notified again', async () => {
  await h.pool.query('UPDATE police_units SET is_active = FALSE');
  const inc = (await report({ lat: h.CBD.lat, lng: h.CBD.lng })).body;
  assert.equal((await api().get(`/api/v1/incidents/${inc.id}`)).body.status, 'reported');
  assert.equal((await staffView(inc.id)).assignment?.police ?? null, null);

  let res = await post(`/api/v1/incidents/${inc.id}/police`, T.dispatcher);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'NO_POLICE_AVAILABLE');

  await h.pool.query('UPDATE police_units SET is_active = TRUE');
  const unit = (await h.pool.query('SELECT id FROM police_units WHERE is_active LIMIT 1')).rows[0];
  res = await post(`/api/v1/incidents/${inc.id}/police`, T.dispatcher, { police_unit_id: unit.id });
  assert.equal(res.status, 200);
  assert.equal(res.body.assignment.police.unit_id, unit.id);
  assert.equal((await api().get(`/api/v1/incidents/${inc.id}`)).body.status, 'policeNotified');
});

test('an unknown or disabled unit is rejected', async () => {
  const inc = (await report({ lat: h.CBD.lat, lng: h.CBD.lng })).body;
  const missing = await post(`/api/v1/incidents/${inc.id}/police`, T.dispatcher, { police_unit_id: '00000000-0000-4000-8000-000000000000' });
  assert.equal(missing.status, 404);
});

test('only dispatchers and administrators may do this', async () => {
  const inc = (await report({ lat: h.CBD.lat, lng: h.CBD.lng })).body;
  assert.equal((await api().post(`/api/v1/incidents/${inc.id}/police`).send({})).status, 401);
  assert.equal((await post(`/api/v1/incidents/${inc.id}/police`, T.police1)).status, 403);
  assert.equal((await post(`/api/v1/incidents/${inc.id}/police`, T.amb1)).status, 403);
  assert.equal((await post(`/api/v1/incidents/${inc.id}/police`, T.hospital1 || T.hosp1 || T.amb2)).status, 403);
  assert.equal((await post(`/api/v1/incidents/${inc.id}/police`, T.admin)).status, 200, 'an administrator has all dispatcher rights');
});
