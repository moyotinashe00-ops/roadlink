const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

// NFR10: "No change to an incident shall be possible without being recorded in the timeline."
//
// This walks a whole incident through every state-changing endpoint and checks that each successful
// call adds at least one timeline entry (and that rejected calls add none). A new endpoint that
// changes an incident but forgets the audit trail will break the "every change" test below, which is
// how the unrecorded photo upload was found.

let srv; let T;
const api = () => srv.request;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

before(async () => { await h.resetDb(); srv = await h.startServer(); T = await h.loginAll(srv.request); });
after(async () => { await srv.close(); await h.pool.end(); });

const timeline = async (id) => (await api().get(`/api/v1/incidents/${id}/timeline`).set(h.auth(T.dispatcher))).body.timeline;

describe('audit trail (NFR10)', () => {
  test('every state-changing call adds a timeline entry', async () => {
    const created = await api().post('/api/v1/incidents').send({ lat: h.CBD.lat, lng: h.CBD.lng, severity: 'critical', victim_count: 2 });
    assert.equal(created.status, 201);
    const id = created.body.id;
    const base = `/api/v1/incidents/${id}`;
    const hospitals = (await api().get('/api/v1/hospitals').set(h.auth(T.dispatcher))).body.hospitals;
    const central = hospitals.find((x) => x.name === 'Harare Central Hospital');

    const steps = [
      ['report a photo (UC2)', () => api().post(`${base}/photo`).attach('photo', PNG, { filename: 'a.png', contentType: 'image/png' }), 201],
      ['police accept', () => api().post(`${base}/police/accept`).set(h.auth(T.police1)), 200],
      ['police on scene', () => api().post(`${base}/police/on-scene`).set(h.auth(T.police1)), 200],
      ['scene details', () => api().patch(`${base}/scene`).set(h.auth(T.police1)).send({ verified_victim_count: 3, hazard_notes: 'Fuel spill' }), 200],
      ['case reference', () => api().put(`${base}/case-reference`).set(h.auth(T.police1)).send({ reference_number: 'CR 200/26' }), 200],
      ['assign ambulance', () => api().post(`${base}/ambulance`).set(h.auth(T.dispatcher)).send({}), 200],
      ['assign hospital', () => api().post(`${base}/hospital`).set(h.auth(T.dispatcher)).send({ hospital_id: central.id }), 200],
      ['ambulance en route', () => api().post(`${base}/ambulance/status`).set(h.auth(T.amb1)).send({ status: 'enRoute' }), 200],
      ['ambulance on scene', () => api().post(`${base}/ambulance/status`).set(h.auth(T.amb1)).send({ status: 'onScene' }), 200],
      ['record vitals', () => api().post(`${base}/ambulance/vitals`).set(h.auth(T.amb1)).send({ pulse_bpm: 110, spo2_percent: 95 }), 200],
      ['ambulance transporting', () => api().post(`${base}/ambulance/status`).set(h.auth(T.amb1)).send({ status: 'transporting' }), 200],
      ['hospital acknowledge', () => api().post(`${base}/hospital/acknowledge`).set(h.auth(T.hosp2)), 200],
      ['ambulance arrived', () => api().post(`${base}/ambulance/status`).set(h.auth(T.amb1)).send({ status: 'arrived' }), 200],
      ['hospital admit', () => api().post(`${base}/hospital/admit`).set(h.auth(T.hosp2)), 200],
      ['police clear', () => api().post(`${base}/police/clear`).set(h.auth(T.police1)), 200],
      ['close', () => api().post(`${base}/close`).set(h.auth(T.dispatcher)).send({ outcome: 'completed' }), 200],
    ];

    let seen = (await timeline(id)).length;
    for (const [name, call, expected] of steps) {
      const res = await call();
      assert.equal(res.status, expected, `${name}: HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
      const now = (await timeline(id)).length;
      assert.ok(now > seen, `${name} changed the incident but wrote no timeline entry (NFR10)`);
      seen = now;
    }
  });

  test('a rejected change leaves no trace in the timeline', async () => {
    const created = await api().post('/api/v1/incidents').send({ lat: h.CBD.lat + 0.03, lng: h.CBD.lng, severity: 'minor' });
    const id = created.body.id;
    const before = (await timeline(id)).length;
    // functions, not started requests: each one must run on its own
    const attempts = [
      () => api().post(`/api/v1/incidents/${id}/police/accept`).set(h.auth(T.police2)),                         // not their incident
      () => api().post(`/api/v1/incidents/${id}/ambulance/status`).set(h.auth(T.amb2)).send({ status: 'enRoute' }), // not assigned
      () => api().post(`/api/v1/incidents/${id}/ambulance/vitals`).set(h.auth(T.amb1)).send({ pulse_bpm: 70 }),     // not assigned
      () => api().post(`/api/v1/incidents/${id}/photo`).attach('photo', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' }),
    ];
    for (const attempt of attempts) assert.ok((await attempt()).status >= 400);
    assert.equal((await timeline(id)).length, before);
  });
});

describe('photo attachment (UC2)', () => {
  test('is recorded in the timeline as a citizen action, exactly once', async () => {
    const id = (await api().post('/api/v1/incidents').send({ lat: h.CBD.lat + 0.06, lng: h.CBD.lng, severity: 'serious' })).body.id;
    const up = (name) => api().post(`/api/v1/incidents/${id}/photo`).attach('photo', PNG, { filename: name, contentType: 'image/png' });
    assert.equal((await up('a.png')).status, 201);
    assert.equal((await up('b.png')).status, 409); // only one photo per incident (FR1)
    const entries = (await timeline(id)).filter((e) => e.event === 'photo_attached');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].actor_role, 'citizen');
  });

  test('two simultaneous uploads: exactly one wins, and exactly one entry is written', async () => {
    const id = (await api().post('/api/v1/incidents').send({ lat: h.CBD.lat + 0.09, lng: h.CBD.lng, severity: 'serious' })).body.id;
    const up = (name) => api().post(`/api/v1/incidents/${id}/photo`).attach('photo', PNG, { filename: name, contentType: 'image/png' });
    const statuses = (await Promise.all([up('a.png'), up('b.png')])).map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409]);
    assert.equal((await timeline(id)).filter((e) => e.event === 'photo_attached').length, 1);
  });

  test('a closed incident refuses a photo and records nothing', async () => {
    const id = (await api().post('/api/v1/incidents').send({ lat: h.CBD.lat + 0.12, lng: h.CBD.lng, severity: 'minor' })).body.id;
    assert.equal((await api().post(`/api/v1/incidents/${id}/close`).set(h.auth(T.dispatcher)).send({ outcome: 'false_alarm' })).status, 200);
    const before = (await timeline(id)).length;
    const res = await api().post(`/api/v1/incidents/${id}/photo`).attach('photo', PNG, { filename: 'a.png', contentType: 'image/png' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'INCIDENT_CLOSED');
    assert.equal((await timeline(id)).length, before);
  });
});
