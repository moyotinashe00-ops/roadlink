const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let srv; let T; // server, tokens
const api = () => srv.request;
const base = '/api/v1/incidents';

before(async () => { await h.resetDb(); srv = await h.startServer(); T = await h.loginAll(srv.request); });
after(async () => { await srv.close(); await h.pool.end(); });

// A crash with an ambulance (ADX-1001 -> crew amb1) and Harare Central Hospital (desk hosp2) assigned.
async function incidentWithCrewAndHospital(at = h.CBD) {
  const rep = await api().post(base).send({ lat: at.lat, lng: at.lng, victim_count: 1, severity: 'critical', description: 'Vitals test' });
  assert.equal(rep.status, 201);
  const id = rep.body.id;
  const amb = await api().post(`${base}/${id}/ambulance`).set(h.auth(T.dispatcher)).send({});
  assert.equal(amb.status, 200);
  const hospitals = (await api().get('/api/v1/hospitals').set(h.auth(T.dispatcher))).body.hospitals;
  const central = hospitals.find((x) => x.name === 'Harare Central Hospital');
  assert.equal((await api().post(`${base}/${id}/hospital`).set(h.auth(T.dispatcher)).send({ hospital_id: central.id })).status, 200);
  return id;
}

describe('patient vitals (UC9, FR9, FR10)', () => {
  let id;
  const full = { pulse_bpm: 137, systolic_bp: 90, diastolic_bp: 60, spo2_percent: 93, consciousness: 'voice' };

  before(async () => { id = await incidentWithCrewAndHospital(); });

  test('the assigned crew records a full set; it comes back as latest_vitals and the status is unchanged', async () => {
    const before = (await api().get(`${base}/${id}`).set(h.auth(T.dispatcher))).body;
    assert.equal(before.latest_vitals, null); // nothing recorded yet
    const res = await api().post(`${base}/${id}/ambulance/vitals`).set(h.auth(T.amb1)).send(full);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, before.status);
    assert.equal(res.body.latest_vitals.pulse_bpm, 137);
    assert.equal(res.body.latest_vitals.systolic_bp, 90);
    assert.equal(res.body.latest_vitals.diastolic_bp, 60);
    assert.equal(res.body.latest_vitals.spo2_percent, 93);
    assert.equal(res.body.latest_vitals.consciousness, 'voice');
    assert.ok(Date.now() - new Date(res.body.latest_vitals.recorded_at).getTime() < 10000);
  });

  test('a partial set is accepted (UC9 A1) and becomes the latest reading; the history keeps both', async () => {
    const res = await api().post(`${base}/${id}/ambulance/vitals`).set(h.auth(T.amb1)).send({ spo2_percent: 96, consciousness: 'alert' });
    assert.equal(res.status, 200);
    assert.equal(res.body.latest_vitals.spo2_percent, 96);
    assert.equal(res.body.latest_vitals.pulse_bpm, null);
    assert.equal(res.body.latest_vitals.systolic_bp, null);

    const hist = await api().get(`${base}/${id}/vitals`).set(h.auth(T.dispatcher));
    assert.equal(hist.status, 200);
    assert.equal(hist.body.vitals.length, 2);
    assert.equal(hist.body.vitals[0].spo2_percent, 96);   // newest first
    assert.equal(hist.body.vitals[1].pulse_bpm, 137);
    assert.equal(hist.body.vitals[1].recorded_by, 'Crew ADX-1001');
  });

  test('bad readings are rejected', async () => {
    const post = (body) => api().post(`${base}/${id}/ambulance/vitals`).set(h.auth(T.amb1)).send(body);
    assert.equal((await post({})).status, 400);                                          // nothing entered
    assert.equal((await post({ systolic_bp: 120 })).status, 400);                        // BP is a pair
    assert.equal((await post({ diastolic_bp: 80 })).status, 400);
    assert.equal((await post({ systolic_bp: 70, diastolic_bp: 110 })).status, 400);      // diastolic above systolic
    assert.equal((await post({ spo2_percent: 101 })).status, 400);
    assert.equal((await post({ pulse_bpm: -1 })).status, 400);
    assert.equal((await post({ pulse_bpm: 72.5 })).status, 400);                         // whole numbers only
    assert.equal((await post({ pulse_bpm: '72' })).status, 400);
    assert.equal((await post({ consciousness: 'asleep' })).status, 400);                 // AVPU values only
    assert.equal((await post({ pulse_bpm: 80, blood_type: 'O+' })).status, 400);         // unknown field
    // nothing bad was stored
    assert.equal((await api().get(`${base}/${id}/vitals`).set(h.auth(T.dispatcher))).body.vitals.length, 2);
  });

  test('a pulse of 0 is a valid reading (cardiac arrest is not "missing")', async () => {
    const res = await api().post(`${base}/${id}/ambulance/vitals`).set(h.auth(T.amb1)).send({ pulse_bpm: 0, consciousness: 'unresponsive' });
    assert.equal(res.status, 200);
    assert.equal(res.body.latest_vitals.pulse_bpm, 0);
    // restore a normal reading so the later tests have something sensible as "latest"
    await api().post(`${base}/${id}/ambulance/vitals`).set(h.auth(T.amb1)).send(full);
  });

  test('only the assigned ambulance crew may record vitals', async () => {
    const send = (token) => api().post(`${base}/${id}/ambulance/vitals`).set(token ? h.auth(token) : {}).send({ pulse_bpm: 80 });
    assert.equal((await send(T.amb2)).status, 403);        // another crew
    assert.equal((await send(T.police1)).status, 403);
    assert.equal((await send(T.hosp2)).status, 403);
    assert.equal((await send(T.dispatcher)).status, 403);
    assert.equal((await send(T.admin)).status, 403);
    assert.equal((await send(null)).status, 401);          // not logged in
  });

  test('a crew with no ambulance assigned to the incident cannot record vitals', async () => {
    const lone = await api().post(base).send({ lat: h.CBD.lat + 0.02, lng: h.CBD.lng, victim_count: 1, severity: 'minor' });
    assert.equal(lone.status, 201);
    const res = await api().post(`${base}/${lone.body.id}/ambulance/vitals`).set(h.auth(T.amb1)).send({ pulse_bpm: 80 });
    assert.equal(res.status, 403);
  });

  test('dispatcher, admin, the crew and the receiving hospital see the latest vitals', async () => {
    for (const who of ['dispatcher', 'admin', 'amb1', 'hosp2']) {
      const one = await api().get(`${base}/${id}`).set(h.auth(T[who]));
      assert.equal(one.status, 200, who);
      assert.equal(one.body.latest_vitals.pulse_bpm, 137, who);
      assert.equal(one.body.latest_vitals.consciousness, 'voice', who);
      const list = (await api().get(base).set(h.auth(T[who]))).body.incidents.find((i) => i.id === id);
      assert.equal(list.latest_vitals.systolic_bp, 90, `${who} list`);
    }
    const hist = await api().get(`${base}/${id}/vitals`).set(h.auth(T.hosp2));
    assert.equal(hist.status, 200);
    assert.ok(hist.body.vitals.length >= 3);
  });

  test('police, citizens, other hospitals and other crews never see vitals (NFR6)', async () => {
    // police: sees the incident, but the vitals field is absent
    const police = await api().get(`${base}/${id}`).set(h.auth(T.police1));
    assert.equal(police.status, 200);
    assert.equal('latest_vitals' in police.body, false);
    const policeList = (await api().get(base).set(h.auth(T.police1))).body.incidents.find((i) => i.id === id);
    assert.equal('latest_vitals' in policeList, false);
    assert.equal((await api().get(`${base}/${id}/vitals`).set(h.auth(T.police1))).status, 403);

    // a citizen holding the incident id gets the public view only
    const citizen = await api().get(`${base}/${id}`);
    assert.equal(citizen.status, 200);
    assert.equal('latest_vitals' in citizen.body, false);
    assert.equal((await api().get(`${base}/${id}/vitals`)).status, 401);

    // a hospital that is not receiving this patient, and a crew that is not on this job
    assert.equal((await api().get(`${base}/${id}/vitals`).set(h.auth(T.hosp1))).status, 403);
    assert.equal((await api().get(`${base}/${id}/vitals`).set(h.auth(T.amb2))).status, 403);
    assert.equal((await api().get(`${base}/${id}`).set(h.auth(T.hosp1))).status, 403);
  });

  test('the timeline records THAT vitals were taken but never the values (police can read the timeline)', async () => {
    const tl = await api().get(`${base}/${id}/timeline`).set(h.auth(T.police1));
    assert.equal(tl.status, 200);
    assert.ok(tl.body.timeline.some((e) => e.event === 'vitals_recorded' && e.actor_role === 'ambulance'));
    const text = JSON.stringify(tl.body);
    for (const secret of ['137', '90/60', 'unresponsive', 'voice']) assert.equal(text.includes(secret), false, `timeline leaked ${secret}`);
  });

  test('live updates: the hospital and the dispatcher get the vitals; the police unit does not', async () => {
    const hosp = await h.connectSocket(srv.url, T.hosp2);
    const disp = await h.connectSocket(srv.url, T.dispatcher);
    const police = await h.connectSocket(srv.url, T.police1);
    try {
      const isVitals = (p) => p.event === 'vitals_recorded' && p.incident.id === id;
      const gotHosp = h.waitFor(hosp, 'incident:update', isVitals);
      const gotDisp = h.waitFor(disp, 'incident:update', isVitals);
      const gotPolice = h.waitFor(police, 'incident:update', isVitals);
      const res = await api().post(`${base}/${id}/ambulance/vitals`).set(h.auth(T.amb1)).send({ pulse_bpm: 101, spo2_percent: 95 });
      assert.equal(res.status, 200);
      assert.equal((await gotHosp).incident.latest_vitals.pulse_bpm, 101);
      assert.equal((await gotDisp).incident.latest_vitals.spo2_percent, 95);
      const p = await gotPolice; // police still hear that the incident changed ...
      assert.equal('latest_vitals' in p.incident, false); // ... but receive no clinical data
      assert.equal(JSON.stringify(p).includes('101'), false);
    } finally { hosp.close(); disp.close(); police.close(); }
  });

  test('the database itself refuses an empty reading or an unpaired blood pressure', async () => {
    await assert.rejects(h.pool.query('INSERT INTO patient_vitals (incident_id) VALUES ($1)', [id]), /patient_vitals_not_empty/);
    await assert.rejects(h.pool.query('INSERT INTO patient_vitals (incident_id, systolic_bp) VALUES ($1, 120)', [id]), /patient_vitals_bp_pair/);
  });

  test('vitals cannot be added once the incident is closed, but stay readable', async () => {
    const close = await api().post(`${base}/${id}/close`).set(h.auth(T.dispatcher)).send({ outcome: 'cancelled' });
    assert.equal(close.status, 200);
    const res = await api().post(`${base}/${id}/ambulance/vitals`).set(h.auth(T.amb1)).send({ pulse_bpm: 80 });
    assert.equal(res.status, 409);
    assert.equal(res.body.code ?? res.body.error?.code, 'INCIDENT_CLOSED');
    assert.equal((await api().get(`${base}/${id}/vitals`).set(h.auth(T.dispatcher))).status, 200);
  });
});
