const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let srv; let T; // server, tokens
const api = () => srv.request;

before(async () => { await h.resetDb(); srv = await h.startServer(); T = await h.loginAll(srv.request); });
after(async () => { await srv.close(); await h.pool.end(); });

describe('full incident lifecycle (SRS section 9)', () => {
  let incidentId;

  test('citizen reports without an account; nearest police unit is alerted automatically', async () => {
    // Exactly the JSON body the Flutter Reporter app sends (extra created_at field is ignored).
    const res = await api().post('/api/v1/incidents').send({
      lat: h.CBD.lat, lng: h.CBD.lng, victim_count: 2, severity: 'serious',
      description: 'Two cars collided at the roundabout', created_at: new Date().toISOString(),
    });
    assert.equal(res.status, 201);
    assert.match(res.body.reference_number, /^RL-\d{2}\d{5}$/);
    assert.equal(res.body.status, 'policeNotified');   // police alerted synchronously
    assert.equal(res.body.severity, 'serious');
    assert.equal(res.body.merged, false);
    assert.equal(typeof res.body.lat, 'number');
    // citizens must never get staff-only data
    assert.equal(res.body.assignment, undefined);
    assert.equal(res.body.reporter_phone, undefined);
    incidentId = res.body.id;
  });

  test('citizen can poll their report by id; unknown / malformed ids are handled', async () => {
    const ok = await api().get(`/api/v1/incidents/${incidentId}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, 'policeNotified');
    assert.equal((await api().get('/api/v1/incidents/00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await api().get('/api/v1/incidents/not-a-uuid')).status, 400);
  });

  test('only the alerted police unit can act on it', async () => {
    const wrong = await api().post(`/api/v1/incidents/${incidentId}/police/accept`).set(h.auth(T.police2));
    assert.equal(wrong.status, 403);
    const ok = await api().post(`/api/v1/incidents/${incidentId}/police/accept`).set(h.auth(T.police1));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.assignment.police.state, 'accepted');
    const again = await api().post(`/api/v1/incidents/${incidentId}/police/accept`).set(h.auth(T.police1));
    assert.equal(again.status, 409);
  });

  test('police confirm on scene and correct the victim count / add hazards', async () => {
    const on = await api().post(`/api/v1/incidents/${incidentId}/police/on-scene`).set(h.auth(T.police1));
    assert.equal(on.body.status, 'policeOnScene');
    const upd = await api().patch(`/api/v1/incidents/${incidentId}/scene`).set(h.auth(T.police1))
      .send({ verified_victim_count: 3, hazard_notes: 'Fuel spill, left lane blocked' });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.verified_victim_count, 3);
    assert.equal(upd.body.victim_count, 3);
    assert.equal((await api().patch(`/api/v1/incidents/${incidentId}/scene`).set(h.auth(T.police1)).send({})).status, 400);
  });

  test('dispatcher gets ranked recommendations (nearest ambulance first, full hospitals last)', async () => {
    const res = await api().get(`/api/v1/incidents/${incidentId}/recommendations`).set(h.auth(T.dispatcher));
    assert.equal(res.status, 200);
    assert.equal(res.body.ambulances[0].plate_number, 'ADX-1001');
    assert.ok(res.body.ambulances[0].eta_minutes >= 1);
    const names = res.body.hospitals.map((x) => x.name);
    assert.equal(names[names.length - 1], 'Chitungwiza Central Hospital'); // 0 free bays => ranked last
    assert.equal(res.body.hospitals.at(-1).has_capacity, false);
    // other roles may not see dispatch recommendations
    assert.equal((await api().get(`/api/v1/incidents/${incidentId}/recommendations`).set(h.auth(T.police1))).status, 403);
  });

  test('dispatcher assigns the recommended ambulance', async () => {
    const res = await api().post(`/api/v1/incidents/${incidentId}/ambulance`).set(h.auth(T.dispatcher)).send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.assignment.ambulance.plate_number, 'ADX-1001');
    assert.equal(res.body.status, 'ambulanceAssigned');
    assert.ok(res.body.eta_minutes >= 1);
    const amb = await api().get('/api/v1/ambulances').set(h.auth(T.dispatcher));
    assert.equal(amb.body.ambulances.find((a) => a.plate_number === 'ADX-1001').is_available, false);
  });

  test('only the assigned crew can update status, and only forward', async () => {
    const path = `/api/v1/incidents/${incidentId}/ambulance/status`;
    assert.equal((await api().post(path).set(h.auth(T.amb2)).send({ status: 'enRoute' })).status, 403);
    const en = await api().post(path).set(h.auth(T.amb1)).send({ status: 'enRoute' });
    assert.equal(en.body.status, 'ambulanceEnRoute');
    assert.equal((await api().post(path).set(h.auth(T.amb1)).send({ status: 'enRoute' })).status, 409);
    assert.equal((await api().post(path).set(h.auth(T.amb1)).send({ status: 'flying' })).status, 400);
    assert.equal((await api().post(path).set(h.auth(T.amb1)).send({ status: 'onScene' })).body.status, 'ambulanceOnScene');
    assert.equal((await api().post(path).set(h.auth(T.amb1)).send({ status: 'transporting' })).body.status, 'transporting');
  });

  test('dispatcher notifies a hospital; only that hospital can acknowledge and admit', async () => {
    const hospitals = (await api().get('/api/v1/hospitals').set(h.auth(T.dispatcher))).body.hospitals;
    const central = hospitals.find((x) => x.name === 'Harare Central Hospital');
    const res = await api().post(`/api/v1/incidents/${incidentId}/hospital`).set(h.auth(T.dispatcher)).send({ hospital_id: central.id });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'hospitalNotified');
    assert.equal(res.body.assignment.hospital.state, 'notified');
    assert.deepEqual(res.body.warnings, []);
    // the ambulance crew navigates to these, and the hospital desk counts down from assigned_at
    const hosp = res.body.assignment.hospital;
    assert.equal(typeof hosp.lat, 'number');
    assert.equal(typeof hosp.lng, 'number');
    assert.ok(hosp.phone);
    assert.ok(Date.now() - new Date(hosp.assigned_at).getTime() < 10000);
    assert.ok(res.body.assignment.ambulance.assigned_at);

    // hosp1 is Parirenyatwa: not the receiving hospital
    assert.equal((await api().post(`/api/v1/incidents/${incidentId}/hospital/acknowledge`).set(h.auth(T.hosp1))).status, 403);
    // the receiving hospital sees it in its own list
    const mine = await api().get('/api/v1/incidents').set(h.auth(T.hosp2));
    assert.equal(mine.body.incidents.length, 1);
    assert.equal((await api().get('/api/v1/incidents').set(h.auth(T.hosp1))).body.incidents.length, 0);

    const ack = await api().post(`/api/v1/incidents/${incidentId}/hospital/acknowledge`).set(h.auth(T.hosp2));
    assert.equal(ack.body.assignment.hospital.state, 'acknowledged');

    await api().post(`/api/v1/incidents/${incidentId}/ambulance/status`).set(h.auth(T.amb1)).send({ status: 'arrived' });
    const admit = await api().post(`/api/v1/incidents/${incidentId}/hospital/admit`).set(h.auth(T.hosp2));
    assert.equal(admit.body.status, 'admitted');
  });

  test('dispatcher closes the incident; ambulance and police are released', async () => {
    const res = await api().post(`/api/v1/incidents/${incidentId}/close`).set(h.auth(T.dispatcher)).send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'closed');
    assert.ok(res.body.closed_at);

    const amb = await api().get('/api/v1/ambulances').set(h.auth(T.dispatcher));
    assert.equal(amb.body.ambulances.find((a) => a.plate_number === 'ADX-1001').is_available, true);
    const pol = await api().get('/api/v1/police-units').set(h.auth(T.dispatcher));
    assert.equal(pol.body.police_units.find((p) => p.name.includes('Harare Central')).is_available, true);

    // closed incidents reject further state changes...
    assert.equal((await api().post(`/api/v1/incidents/${incidentId}/ambulance`).set(h.auth(T.dispatcher)).send({})).status, 409);
    // ...but police may still file the case number afterwards
    const cr = await api().put(`/api/v1/incidents/${incidentId}/case-reference`).set(h.auth(T.police1)).send({ reference_number: 'CR 123/26' });
    assert.equal(cr.status, 200);
    assert.equal(cr.body.case_reference, 'CR 123/26');
  });

  test('the audit trail records every step, in order, with the actor', async () => {
    const res = await api().get(`/api/v1/incidents/${incidentId}/timeline`).set(h.auth(T.dispatcher));
    const events = res.body.timeline.map((e) => e.event);
    assert.deepEqual(events, [
      'incident_created', 'police_notified', 'police_accepted', 'police_on_scene', 'scene_updated',
      'ambulance_assigned', 'ambulance_en_route', 'ambulance_on_scene', 'ambulance_transporting',
      'hospital_notified', 'hospital_acknowledged', 'ambulance_arrived_at_hospital', 'patient_admitted',
      'incident_closed_completed', 'case_reference_recorded',
    ]);
    assert.equal(res.body.timeline[0].actor_role, 'citizen');
    assert.equal(res.body.timeline[1].actor_role, 'system');
    assert.equal(res.body.timeline.find((e) => e.event === 'patient_admitted').actor_name, 'Harare Central ED Desk');
  });
});

describe('headline status never regresses', () => {
  test('a late police event is logged but does not move the citizen-visible status backwards', async () => {
    // The first incident is closed, so this CBD report is new and police1 (Harare Central) is alerted.
    const created = await api().post('/api/v1/incidents').send({ lat: h.CBD.lat, lng: h.CBD.lng, severity: 'critical', victim_count: 1 });
    assert.equal(created.status, 201);
    const id = created.body.id;
    const hosp = await api().post(`/api/v1/incidents/${id}/hospital`).set(h.auth(T.dispatcher)).send({});
    assert.equal(hosp.body.status, 'hospitalNotified');

    const on = await api().post(`/api/v1/incidents/${id}/police/on-scene`).set(h.auth(T.police1));
    assert.equal(on.status, 200);
    assert.equal(on.body.status, 'hospitalNotified'); // stayed ahead; did not fall back to policeOnScene

    const tl = await api().get(`/api/v1/incidents/${id}/timeline`).set(h.auth(T.dispatcher));
    const ev = tl.body.timeline.find((e) => e.event === 'police_on_scene');
    assert.ok(ev, 'the late event is still in the audit trail');
    assert.equal(ev.new_status, 'hospitalNotified');

    // Release police1 so later tests start from a clean slate.
    const close = await api().post(`/api/v1/incidents/${id}/close`).set(h.auth(T.dispatcher)).send({ outcome: 'false_alarm' });
    assert.equal(close.status, 200);
  });
});

describe('real-time fan-out (Socket.IO)', () => {
  test('dispatch, the alerted unit and the citizen are told; unrelated units are not', async () => {
    const disp = await h.connectSocket(srv.url, T.dispatcher);
    const pol1 = await h.connectSocket(srv.url, T.police1);
    const pol2 = await h.connectSocket(srv.url, T.police2);
    const citizen = await h.connectSocket(srv.url, null);

    const dispNew = h.waitFor(disp, 'incident:new');
    const pol1New = h.waitFor(pol1, 'incident:new');
    const pol2Quiet = h.expectSilence(pol2, 'incident:new');

    // far from any earlier incident so it is not merged as a duplicate
    const created = await api().post('/api/v1/incidents').send({ lat: -17.8301, lng: 31.0690, severity: 'minor', victim_count: 1 });
    const id = created.body.id;
    assert.equal(created.status, 201);

    assert.equal((await dispNew).incident.id, id);
    assert.equal((await pol1New).incident.id, id);
    assert.equal(await pol2Quiet, true, 'police2 must not hear about an incident that is not theirs');

    // citizen subscribes to their own incident and receives only the public view
    const watch = await new Promise((r) => citizen.emit('watch', id, r));
    assert.equal(watch.ok, true);
    const bad = await new Promise((r) => citizen.emit('watch', 'nope', r));
    assert.ok(bad.error);

    const citizenUpdate = h.waitFor(citizen, 'incident:update', (p) => p.event === 'ambulance_assigned');
    await api().post(`/api/v1/incidents/${id}/ambulance`).set(h.auth(T.dispatcher)).send({});
    const upd = await citizenUpdate;
    assert.equal(upd.incident.status, 'ambulanceAssigned');
    assert.equal(upd.incident.assignment, undefined);
    assert.equal(upd.incident.reporter_phone, undefined);

    for (const s of [disp, pol1, pol2, citizen]) s.disconnect();
  });

  test('sockets reject bad tokens', async () => {
    await assert.rejects(h.connectSocket(srv.url, 'garbage.token.value'), /unauthorized/);
  });
});
