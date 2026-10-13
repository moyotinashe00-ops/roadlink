const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let srv; let T;
const api = () => srv.request;
const report = (body) => api().post('/api/v1/incidents').send({ severity: 'minor', victim_count: 1, ...body });

/** Close every open incident through the API so resources are released the way production releases them. */
async function closeAllOpen() {
  const open = (await api().get('/api/v1/incidents?limit=200').set(h.auth(T.dispatcher))).body.incidents;
  for (const i of open) await api().post(`/api/v1/incidents/${i.id}/close`).set(h.auth(T.dispatcher)).send({ outcome: 'cancelled' });
}

before(async () => { await h.resetDb(); srv = await h.startServer(); T = await h.loginAll(srv.request); });
after(async () => { await srv.close(); await h.pool.end(); });

describe('duplicate reports', () => {
  test('a second bystander ~50 m away is merged into the same incident and escalates severity', async () => {
    const a = await report({ lat: -17.8295, lng: 31.0525, severity: 'serious', victim_count: 2, description: 'Collision at the robot' });
    const b = await report({ lat: -17.8299, lng: 31.0527, severity: 'critical', victim_count: 4, description: 'Someone is trapped' });
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(b.body.merged, true);
    assert.equal(b.body.id, a.body.id);
    assert.equal(b.body.reference_number, a.body.reference_number);
    assert.equal(b.body.severity, 'critical');
    assert.equal(b.body.victim_count, 4);

    const full = await api().get(`/api/v1/incidents/${a.body.id}`).set(h.auth(T.dispatcher));
    assert.equal(full.body.report_count, 2);
    assert.match(full.body.description, /Collision at the robot \| Someone is trapped/);
    const open = await api().get('/api/v1/incidents').set(h.auth(T.dispatcher));
    assert.equal(open.body.incidents.length, 1);
  });

  test('a report ~2 km away is a separate incident', async () => {
    const far = await report({ lat: -17.8295, lng: 31.0725 });
    assert.equal(far.status, 201);
    assert.equal(far.body.merged, false);
  });
});

describe('ambulance allocation under contention', () => {
  test('two dispatchers racing for the SAME ambulance: exactly one wins', async () => {
    const i1 = (await report({ lat: -17.9, lng: 31.2 })).body.id;
    const i2 = (await report({ lat: -17.7, lng: 30.9 })).body.id;
    const amb = (await api().get('/api/v1/ambulances').set(h.auth(T.dispatcher))).body.ambulances.find((a) => a.plate_number === 'ADX-1004');

    const [r1, r2] = await Promise.all([
      api().post(`/api/v1/incidents/${i1}/ambulance`).set(h.auth(T.dispatcher)).send({ ambulance_id: amb.id }),
      api().post(`/api/v1/incidents/${i2}/ambulance`).set(h.auth(T.admin)).send({ ambulance_id: amb.id }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    assert.equal(loser.body.error.code, 'AMBULANCE_UNAVAILABLE');
  });

  test('simultaneous auto-assignments never hand out the same ambulance twice', async () => {
    const ids = [];
    for (let k = 0; k < 3; k++) ids.push((await report({ lat: -17.95 - k * 0.03, lng: 31.3 + k * 0.03 })).body.id);
    const results = await Promise.all(ids.map((id) => api().post(`/api/v1/incidents/${id}/ambulance`).set(h.auth(T.dispatcher)).send({})));
    const ok = results.filter((r) => r.status === 200);
    const plates = ok.map((r) => r.body.assignment.ambulance.plate_number);
    assert.equal(new Set(plates).size, plates.length, `duplicate allocation: ${plates}`);
    for (const r of results.filter((r) => r.status !== 200)) assert.equal(r.body.error.code, 'NO_AMBULANCE_AVAILABLE');
  });

  test('with no ambulances left the dispatcher gets a clear 409', async () => {
    await h.pool.query('UPDATE ambulances SET is_available = FALSE');
    const id = (await report({ lat: -18.2, lng: 31.5 })).body.id;
    const res = await api().post(`/api/v1/incidents/${id}/ambulance`).set(h.auth(T.dispatcher)).send({});
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'NO_AMBULANCE_AVAILABLE');
    await h.pool.query('UPDATE ambulances SET is_available = TRUE');
  });
});

describe('police decline / reassign', () => {
  test('declining hands the incident to the next-nearest unit and removes it from the first', async () => {
    const made = await report({ lat: -17.8290, lng: 31.0522, severity: 'serious' });
    const id = made.body.id;
    assert.equal((await api().get(`/api/v1/incidents/${id}`).set(h.auth(T.police1))).status, 200);

    const dec = await api().post(`/api/v1/incidents/${id}/police/decline`).set(h.auth(T.police1)).send({ reason: 'Attending another scene' });
    assert.equal(dec.status, 200);
    assert.ok(dec.body.reassigned_to, 'a different unit should have been alerted');
    assert.equal((await api().get(`/api/v1/incidents/${id}`).set(h.auth(T.police1))).status, 403);

    const tl = await api().get(`/api/v1/incidents/${id}/timeline`).set(h.auth(T.dispatcher));
    const ev = tl.body.timeline.find((e) => e.event === 'police_declined');
    assert.match(ev.note, /Attending another scene/);
    assert.match(ev.note, /reassigned to/);
  });
});

describe('lifecycle rules', () => {
  before(closeAllOpen);

  test('cannot close as "completed" before the hospital admits; false alarms can be closed and free the crew', async () => {
    const id = (await report({ lat: -17.88, lng: 31.12 })).body.id;
    const assign = await api().post(`/api/v1/incidents/${id}/ambulance`).set(h.auth(T.dispatcher)).send({});
    const plate = assign.body.assignment.ambulance.plate_number;

    const early = await api().post(`/api/v1/incidents/${id}/close`).set(h.auth(T.dispatcher)).send({});
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, 'NOT_ADMITTED');

    const fa = await api().post(`/api/v1/incidents/${id}/close`).set(h.auth(T.dispatcher)).send({ outcome: 'false_alarm', note: 'Crash was a tow' });
    assert.equal(fa.status, 200);
    const amb = (await api().get('/api/v1/ambulances').set(h.auth(T.dispatcher))).body.ambulances.find((a) => a.plate_number === plate);
    assert.equal(amb.is_available, true);
    assert.equal((await api().post(`/api/v1/incidents/${id}/close`).set(h.auth(T.dispatcher)).send({ outcome: 'cancelled' })).status, 409);
  });

  test('a crew cannot go available mid-job, and can once they have arrived', async () => {
    const id = (await report({ lat: -17.76, lng: 31.09 })).body.id;
    // force ADX-1001 (amb1) so we know whose token to use
    const amb1 = (await api().get('/api/v1/ambulances').set(h.auth(T.dispatcher))).body.ambulances.find((a) => a.plate_number === 'ADX-1001');
    const as = await api().post(`/api/v1/incidents/${id}/ambulance`).set(h.auth(T.dispatcher)).send({ ambulance_id: amb1.id });
    assert.equal(as.status, 200);
    const blocked = await api().patch('/api/v1/ambulances/me/availability').set(h.auth(T.amb1)).send({ is_available: true });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'JOB_IN_PROGRESS');
    for (const s of ['enRoute', 'onScene', 'transporting', 'arrived']) {
      assert.equal((await api().post(`/api/v1/incidents/${id}/ambulance/status`).set(h.auth(T.amb1)).send({ status: s })).status, 200);
    }
    const freed = await api().patch('/api/v1/ambulances/me/availability').set(h.auth(T.amb1)).send({ is_available: true });
    assert.equal(freed.status, 200);
  });

  test('live location updates feed the nearest-ambulance ranking', async () => {
    const id = (await report({ lat: -18.5, lng: 29.9 })).body.id; // far from every seeded ambulance
    const before = (await api().get(`/api/v1/incidents/${id}/recommendations`).set(h.auth(T.dispatcher))).body.ambulances;
    const target = before.find((a) => a.plate_number === 'ADX-1002');
    assert.ok(target);
    const moved = await api().patch('/api/v1/ambulances/me/location').set(h.auth(T.amb2)).send({ lat: -18.5, lng: 29.9005 });
    assert.equal(moved.status, 204);
    const after = (await api().get(`/api/v1/incidents/${id}/recommendations`).set(h.auth(T.dispatcher))).body.ambulances;
    assert.equal(after[0].plate_number, 'ADX-1002');
    assert.ok(after[0].distance_m < 100);
    assert.equal((await api().patch('/api/v1/ambulances/me/location').set(h.auth(T.amb2)).send({ lat: 999, lng: 0 })).status, 400);
  });
});

describe('own-resource lookups for the mobile apps', () => {
  test('crews and units can read their own vehicle/unit and on-duty state, and only their own', async () => {
    const amb = await api().get('/api/v1/ambulances/me').set(h.auth(T.amb1));
    assert.equal(amb.status, 200);
    assert.equal(amb.body.plate_number, 'ADX-1001');
    assert.equal(typeof amb.body.is_available, 'boolean');
    assert.equal(typeof amb.body.lat, 'number');
    const pol = await api().get('/api/v1/police-units/me').set(h.auth(T.police1));
    assert.equal(pol.status, 200);
    assert.match(pol.body.name, /Harare Central/);
    // role-gated
    assert.equal((await api().get('/api/v1/ambulances/me').set(h.auth(T.police1))).status, 403);
    assert.equal((await api().get('/api/v1/police-units/me').set(h.auth(T.amb1))).status, 403);
    assert.equal((await api().get('/api/v1/ambulances/me')).status, 401);
  });
});

describe('hospital capacity', () => {
  before(closeAllOpen);

  test('staff update bays (validated); full hospitals still assignable but dispatcher is warned', async () => {
    assert.equal((await api().patch('/api/v1/hospitals/me/capacity').set(h.auth(T.hosp2)).send({ trauma_bays_free: 99 })).status, 409);
    const ok = await api().patch('/api/v1/hospitals/me/capacity').set(h.auth(T.hosp2)).send({ trauma_bays_free: 0 });
    assert.equal(ok.status, 200);

    const id = (await report({ lat: -17.8419, lng: 31.0378, severity: 'critical' })).body.id; // right at Harare Central
    const recs = (await api().get(`/api/v1/incidents/${id}/recommendations`).set(h.auth(T.dispatcher))).body.hospitals;
    assert.notEqual(recs[0].name, 'Harare Central Hospital', 'a hospital with no free bays must not be ranked first');

    const hospitals = (await api().get('/api/v1/hospitals').set(h.auth(T.dispatcher))).body.hospitals;
    const central = hospitals.find((x) => x.name === 'Harare Central Hospital');
    const res = await api().post(`/api/v1/incidents/${id}/hospital`).set(h.auth(T.dispatcher)).send({ hospital_id: central.id });
    assert.equal(res.status, 200);
    assert.equal(res.body.warnings.length, 1);
    // non-hospital roles cannot edit capacity
    assert.equal((await api().patch('/api/v1/hospitals/me/capacity').set(h.auth(T.dispatcher)).send({ trauma_bays_free: 1 })).status, 403);
  });
});

describe('admin reporting', () => {
  test('summary derives response times from the audit trail', async () => {
    const id = (await report({ lat: -17.5, lng: 31.5 })).body.id;
    await api().post(`/api/v1/incidents/${id}/ambulance`).set(h.auth(T.dispatcher)).send({});
    const res = await api().get('/api/v1/admin/reports/summary').set(h.auth(T.admin));
    assert.equal(res.status, 200);
    assert.ok(res.body.total_incidents >= 5);
    assert.equal(typeof res.body.avg_report_to_ambulance_assigned_s, 'number');
    assert.ok(res.body.by_source.some((s) => s.source === 'app'));
    assert.equal((await api().get('/api/v1/admin/reports/summary').set(h.auth(T.dispatcher))).status, 403);
  });
});
