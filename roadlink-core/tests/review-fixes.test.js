const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const svc = require('../src/services/incidentService');

let srv; let T;
const api = () => srv.request;
const B = '/api/v1/incidents';

before(async () => { await h.resetDb(); srv = await h.startServer(); T = await h.loginAll(srv.request); });
after(async () => { await srv.close(); await h.pool.end(); });

const report = async (at, extra = {}) => {
  const r = await api().post(B).send({ lat: at.lat, lng: at.lng, severity: 'serious', victim_count: 1, ...extra });
  assert.ok(r.status === 201 || r.status === 200, JSON.stringify(r.body));
  return r.body.id;
};
// Each group starts from a clean database so police1 and the crew ADX-1001 are free and nearest to the CBD.
const fresh = async () => { await h.resetDb(); T = await h.loginAll(api()); };
const close = (id, outcome = 'cancelled') => api().post(`${B}/${id}/close`).set(h.auth(T.dispatcher)).send({ outcome });
const hospitalByName = async (name) =>
  (await api().get('/api/v1/hospitals').set(h.auth(T.dispatcher))).body.hospitals.find((x) => x.name === name);
const away = (n) => ({ lat: h.CBD.lat + 0.02 * n, lng: h.CBD.lng }); // far enough apart never to merge

describe('what the citizen sees: milestones and outcome (review points 3 and 4)', () => {
  before(fresh);

  test('milestones are the stages that really happened, in the order they happened', async () => {
    const id = await report(h.CBD);
    const central = await hospitalByName('Harare Central Hospital');
    await api().post(`${B}/${id}/ambulance`).set(h.auth(T.dispatcher)).send({});
    await api().post(`${B}/${id}/hospital`).set(h.auth(T.dispatcher)).send({ hospital_id: central.id }); // BEFORE the crew moves
    assert.equal((await api().post(`${B}/${id}/ambulance/status`).set(h.auth(T.amb1)).send({ status: 'enRoute' })).status, 200);

    const pub = (await api().get(`${B}/${id}`)).body; // no login: what the Reporter app gets
    assert.equal(pub.outcome, null, 'still open');
    const order = pub.milestones.map((m) => m.status);
    assert.deepEqual(order, ['reported', 'policeNotified', 'ambulanceAssigned', 'hospitalNotified', 'ambulanceEnRoute']);
    assert.ok(pub.milestones.every((m) => !Number.isNaN(Date.parse(m.at))));
    await close(id);
  });

  test('closing with no transport shows the outcome and never claims the patient was admitted', async () => {
    const id = await report(h.CBD);
    await api().post(`${B}/${id}/ambulance`).set(h.auth(T.dispatcher)).send({});
    assert.equal((await api().post(`${B}/${id}/close`).set(h.auth(T.dispatcher)).send({ outcome: 'no_transport' })).status, 200);
    const pub = (await api().get(`${B}/${id}`)).body;
    assert.equal(pub.status, 'closed');
    assert.equal(pub.outcome, 'no_transport');
    assert.ok(!pub.milestones.some((m) => m.status === 'admitted'), 'nobody was admitted');
    assert.ok(!pub.milestones.some((m) => m.status === 'hospitalNotified'));
  });

  test('every outcome is reported as itself, and a completed one includes the admission', async () => {
    for (const outcome of ['false_alarm', 'cancelled']) {
      const id = await report(away(outcome === 'false_alarm' ? 3 : 4));
      await api().post(`${B}/${id}/close`).set(h.auth(T.dispatcher)).send({ outcome });
      assert.equal((await api().get(`${B}/${id}`)).body.outcome, outcome);
    }
    const id = await report(h.CBD);
    const central = await hospitalByName('Harare Central Hospital');
    await api().post(`${B}/${id}/ambulance`).set(h.auth(T.dispatcher)).send({});
    await api().post(`${B}/${id}/hospital`).set(h.auth(T.dispatcher)).send({ hospital_id: central.id });
    for (const status of ['enRoute', 'onScene', 'transporting', 'arrived']) {
      await api().post(`${B}/${id}/ambulance/status`).set(h.auth(T.amb1)).send({ status });
    }
    assert.equal((await api().post(`${B}/${id}/hospital/admit`).set(h.auth(T.hosp2))).status, 200);
    await api().post(`${B}/${id}/close`).set(h.auth(T.dispatcher)).send({ outcome: 'completed' });
    const pub = (await api().get(`${B}/${id}`)).body;
    assert.equal(pub.outcome, 'completed');
    assert.ok(pub.milestones.some((m) => m.status === 'admitted'));
  });

  test('the live update the citizen receives carries the same fields', async () => {
    const id = await report(away(6));
    const citizen = await h.connectSocket(srv.url, null); // a citizen holds no login, only the incident id
    try {
      const watch = await new Promise((r) => citizen.emit('watch', id, r));
      assert.ok(watch && watch.ok !== false, JSON.stringify(watch));
      const got = h.waitFor(citizen, 'incident:update', (p) => p.incident.id === id && p.incident.status === 'closed');
      await close(id, 'false_alarm');
      const p = await got;
      assert.equal(p.incident.outcome, 'false_alarm');
      assert.ok(Array.isArray(p.incident.milestones));
      assert.equal('reported_severity' in p.incident, false, 'and still only the public view');
    } finally { citizen.close(); }
  });
});

describe('reported vs confirmed severity (review point 19)', () => {
  before(fresh);

  test('a police correction keeps the citizens\' original estimate and is not overridden by later reports', async () => {
    const at = h.CBD;
    const id = await report(at, { severity: 'critical', victim_count: 2 });
    await api().post(`${B}/${id}/police/accept`).set(h.auth(T.police1));
    let staff = (await api().get(`${B}/${id}`).set(h.auth(T.dispatcher))).body;
    assert.equal(staff.reported_severity, 'critical');
    assert.equal(staff.severity_confirmed, false);

    // the officer at the scene finds it is less serious than the bystanders thought
    const fix = await api().patch(`${B}/${id}/scene`).set(h.auth(T.police1)).send({ severity: 'serious', verified_victim_count: 1 });
    assert.equal(fix.status, 200);
    staff = (await api().get(`${B}/${id}`).set(h.auth(T.dispatcher))).body;
    assert.equal(staff.severity, 'serious');
    assert.equal(staff.reported_severity, 'critical', 'the original estimate survives the correction');
    assert.equal(staff.severity_confirmed, true);

    // another bystander now reports a worse crash at the same spot
    const again = await api().post(B).send({ lat: at.lat, lng: at.lng, severity: 'fatal', victim_count: 6 });
    assert.equal(again.body.merged, true);
    staff = (await api().get(`${B}/${id}`).set(h.auth(T.dispatcher))).body;
    assert.equal(staff.severity, 'serious', 'verified severity wins');
    assert.equal(staff.victim_count, 1, 'verified victim count wins');
    assert.equal(staff.reported_severity, 'fatal', 'but the reports are still recorded');

    // who gets to see the two values
    const police = await api().get(`${B}/${id}`).set(h.auth(T.police1));
    assert.equal(police.status, 200);
    assert.equal(police.body.reported_severity, 'fatal');
    const pub = (await api().get(`${B}/${id}`)).body;
    assert.equal('reported_severity' in pub, false, 'citizens see the working severity only');
    assert.equal(pub.severity, 'serious');
    await close(id);
  });

  test('before anyone verifies, merged reports still keep the worse severity and the higher count', async () => {
    const at = away(8);
    const id = await report(at, { severity: 'minor', victim_count: 1 });
    await api().post(B).send({ lat: at.lat, lng: at.lng, severity: 'critical', victim_count: 3 });
    const staff = (await api().get(`${B}/${id}`).set(h.auth(T.dispatcher))).body;
    assert.equal(staff.severity, 'critical');
    assert.equal(staff.victim_count, 3);
    assert.equal(staff.severity_confirmed, false);
  });
});

describe('no ambulance assigned (review point 18)', () => {
  const age = (id, mins) => h.pool.query(`UPDATE incidents SET created_at = now() - make_interval(mins => $2::int) WHERE id = $1`, [id, mins]);

  test('dispatch is warned once, in the timeline and live, when nothing has been assigned in time', async () => {
    const id = await report(away(10));
    assert.equal(await svc.alertUnassignedAmbulances(), 0, 'a fresh incident is left alone');
    await age(id, 5);
    const disp = await h.connectSocket(srv.url, T.dispatcher);
    try {
      const live = h.waitFor(disp, 'incident:update', (p) => p.event === 'ambulance_unassigned_alert' && p.incident.id === id);
      assert.equal(await svc.alertUnassignedAmbulances(), 1);
      const p = await live;
      assert.ok(p.incident.ambulance_alert_at, 'the incident carries the alert');
    } finally { disp.close(); }

    const tl = (await api().get(`${B}/${id}/timeline`).set(h.auth(T.dispatcher))).body.timeline;
    const alerts = tl.filter((e) => e.event === 'ambulance_unassigned_alert');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].actor_role, 'system');
    assert.equal(await svc.alertUnassignedAmbulances(), 0, 'no repeat while it is still unanswered');
  });

  test('assigning an ambulance clears the alert', async () => {
    const id = await report(away(11));
    await age(id, 5);
    await svc.alertUnassignedAmbulances();
    assert.ok((await api().get(`${B}/${id}`).set(h.auth(T.dispatcher))).body.ambulance_alert_at);
    await api().post(`${B}/${id}/ambulance`).set(h.auth(T.dispatcher)).send({});
    assert.equal((await api().get(`${B}/${id}`).set(h.auth(T.dispatcher))).body.ambulance_alert_at, null);
  });

  test('no alert for an incident that already has an ambulance, or that is closed', async () => {
    const assigned = await report(away(12));
    await api().post(`${B}/${assigned}/ambulance`).set(h.auth(T.dispatcher)).send({});
    const closed = await report(away(13));
    await api().post(`${B}/${closed}/close`).set(h.auth(T.dispatcher)).send({ outcome: 'false_alarm' });
    await age(assigned, 30); await age(closed, 30);
    assert.equal(await svc.alertUnassignedAmbulances(), 0);
  });
});

describe('hospital reassignment reaches the police unit live (review point 7)', () => {
  before(fresh);

  test('the unit sees the new hospital, with its position, the moment dispatch changes it', async () => {
    const id = await report(h.CBD);
    const hospitals = (await api().get('/api/v1/hospitals').set(h.auth(T.dispatcher))).body.hospitals;
    const [first, second] = hospitals.filter((x) => x.is_active !== false);
    await api().post(`${B}/${id}/ambulance`).set(h.auth(T.dispatcher)).send({});
    await api().post(`${B}/${id}/hospital`).set(h.auth(T.dispatcher)).send({ hospital_id: first.id });

    const police = await h.connectSocket(srv.url, T.police1);
    try {
      const got = h.waitFor(police, 'incident:update', (p) => p.incident.id === id && p.incident.assignment.hospital && p.incident.assignment.hospital.hospital_id === second.id);
      const res = await api().post(`${B}/${id}/hospital`).set(h.auth(T.dispatcher)).send({ hospital_id: second.id });
      assert.equal(res.status, 200);
      const p = await got;
      assert.equal(p.incident.assignment.hospital.name, second.name);
      assert.equal(typeof p.incident.assignment.hospital.lat, 'number', 'the officer can navigate to it');
      assert.equal('latest_vitals' in p.incident, false, 'and still gets no clinical data');
    } finally { police.close(); }
  });
});

describe('stale hospital bay numbers (review point 16)', () => {
  before(fresh);

  test('numbers a hospital has not confirmed for hours are flagged, with their age, to dispatch and to the hospital', async () => {
    const central = await hospitalByName('Harare Central Hospital');
    assert.equal(central.capacity_stale, false, 'just seeded: fresh');
    await h.pool.query("UPDATE hospitals SET capacity_updated_at = now() - interval '3 hours' WHERE id = $1", [central.id]);

    const list = (await api().get('/api/v1/hospitals').set(h.auth(T.hosp2))).body.hospitals.find((x) => x.id === central.id);
    assert.equal(list.capacity_stale, true);
    assert.ok(list.capacity_age_min >= 179 && list.capacity_age_min <= 185, `age ${list.capacity_age_min}`);

    const id = await report(h.CBD);
    const rec = (await api().get(`${B}/${id}/recommendations`).set(h.auth(T.dispatcher))).body.hospitals.find((x) => x.id === central.id);
    assert.equal(rec.capacity_stale, true);
    assert.ok(rec.capacity_age_min >= 179);
    await close(id);
  });

  test('"still correct" (saving the same numbers) clears the flag everywhere', async () => {
    const central = await hospitalByName('Harare Central Hospital');
    const res = await api().patch('/api/v1/hospitals/me/capacity').set(h.auth(T.hosp2))
      .send({ trauma_bays_free: central.trauma_bays_free, trauma_bays_total: central.trauma_bays_total });
    assert.equal(res.status, 200);
    assert.equal(res.body.capacity_stale, false);
    assert.equal((await hospitalByName('Harare Central Hospital')).capacity_stale, false);
  });

  test('a hospital that never confirmed its numbers counts as stale, and the threshold is configurable', async () => {
    const [h1] = (await api().get('/api/v1/hospitals').set(h.auth(T.dispatcher))).body.hospitals;
    await h.pool.query("UPDATE hospitals SET capacity_updated_at = now() - interval '59 minutes' WHERE id = $1", [h1.id]);
    assert.equal((await hospitalByName(h1.name)).capacity_stale, false, 'just inside the 60-minute default');
    await h.pool.query("UPDATE hospitals SET capacity_updated_at = now() - interval '61 minutes' WHERE id = $1", [h1.id]);
    assert.equal((await hospitalByName(h1.name)).capacity_stale, true, 'just outside it');
  });
});
