// Checks the Dispatch console against a LIVE RoadLink Core: it uses the console's own API client and
// live-feed code, so a passing run means the screens can really do their job.
// Needs the backend running with the demo data:  CONTRACT_API_URL=http://localhost:3000 npm run contract
import assert from 'node:assert/strict';
import { createApi } from '../src/lib/api.js';
import { connectRealtime } from '../src/lib/realtime.js';

const BASE = process.env.CONTRACT_API_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_PASSWORD || 'ChangeMe123!';

let token = null;
const api = createApi({ baseUrl: BASE, getToken: () => token });
const ok = (msg) => console.log(' \u2713', msg);

async function raw(method, path, tok, body) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const login = async (email) => (await raw('POST', '/auth/login', null, { identifier: email, password: PASSWORD })).body;
const waitFor = (label, find, ms = 4000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { clearInterval(tick); reject(new Error(`timed out waiting for: ${label}`)); }, ms);
  const tick = setInterval(() => { const v = find(); if (v) { clearTimeout(t); clearInterval(tick); resolve(v); } }, 50);
});

// --- sign in as a dispatcher
const me = await api.login('dispatcher@roadlink.zw', PASSWORD);
assert.equal(me.user.role, 'dispatcher');
token = me.token;
ok(`dispatcher signs in (${me.user.name})`);

// --- live feed, exactly as the console connects
const events = []; const moves = []; let status = null;
const rt = connectRealtime({
  baseUrl: BASE, token,
  onEvent: (e) => events.push(e), onResource: (p) => moves.push(p), onStatus: (s) => { status = s; },
});
await waitFor('live connection', () => status === 'online');
ok('live connection opens with the dispatcher token');

// --- fleet for the map
const ambulances = await api.ambulances();
const police = await api.policeUnits();
assert.ok(ambulances.length >= 2 && police.length >= 1, 'the demo data needs 2+ ambulances and 1+ police unit');
for (const a of ambulances) assert.ok(a.id && a.plate_number && typeof a.is_available === 'boolean', 'ambulance fields the map and list need');
for (const p of police) assert.ok(p.id && 'lat' in p && 'lng' in p, 'police unit position fields');
ok(`fleet lists load (${ambulances.length} ambulances, ${police.length} police units)`);

// --- a phoned-in report
const created = await api.createReport({
  lat: -17.8419, lng: 31.0378, severity: 'critical', victim_count: 3, description: 'dispatch contract check',
  location_accuracy: 'approximate', location_label: 'Contract Avenue', reporter_phone: '+263 77 555 0199',
});
assert.ok(created.id && created.reference_number);
const live = await waitFor('incident:new for the report', () => events.find((e) => e.incident.id === created.id && e.isNew));
assert.ok(live.incident.assignment?.police, 'the nearest police unit is alerted straight away');
ok(`phoned-in report ${created.reference_number} reaches the board live, with police alerted`);

const list = await api.listIncidents('all', 100);
const mine = list.find((i) => i.id === created.id);
assert.ok(mine, 'incident appears in the list');
for (const f of ['reference_number', 'lat', 'lng', 'severity', 'status', 'victim_count', 'created_at', 'updated_at', 'assignment']) assert.ok(f in mine, `list item needs ${f}`);
assert.equal(mine.location_label, 'Contract Avenue');
assert.ok(String(mine.reporter_phone).replace(/\D/g, '').endsWith('775550199'.slice(-9)) || mine.reporter_phone, 'dispatchers see the caller phone');
ok('list items carry every field the cards and panel render, including the caller phone');

// --- a scene photo, fetched with the token
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const form = new FormData(); form.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'photo.jpg');
assert.equal((await fetch(`${BASE}/api/v1/incidents/${created.id}/photo`, { method: 'POST', body: form })).status, 201);
const blob = await api.photo(created.id);
assert.ok(blob.size > 0 && blob.type === 'image/jpeg');
ok('the scene photo downloads with the dispatcher token');

// --- recommendations
const recs = await api.recommendations(created.id);
for (const a of recs.ambulances) for (const f of ['id', 'plate_number', 'distance_m', 'eta_minutes', 'location_stale']) assert.ok(f in a, `ambulance recommendation needs ${f}`);
for (const h of recs.hospitals) for (const f of ['id', 'name', 'trauma_bays_free', 'trauma_bays_total', 'has_capacity', 'distance_m', 'eta_minutes', 'capacity_stale']) assert.ok(f in h, `hospital recommendation needs ${f}`);
assert.ok(recs.ambulances.length >= 2 && recs.hospitals.length >= 1);
ok('recommendations carry the fields the pickers show');

// --- alert a different police unit by hand
assert.ok(recs.police.length >= 2, 'police recommendations');
for (const p of recs.police) for (const f of ['id', 'name', 'is_available', 'distance_m', 'eta_minutes', 'location_stale']) assert.ok(f in p, `police recommendation needs ${f}`);
const alerted = live.incident.assignment.police.unit_id;
const altUnit = recs.police.find((p) => p.id !== alerted);
const rePoliced = await api.assignPolice(created.id, altUnit.id);
assert.equal(rePoliced.assignment.police.unit_id, altUnit.id);
await waitFor('police_assigned', () => events.find((e) => e.incident.id === created.id && e.event === 'police_assigned'));
await assert.rejects(() => api.assignPolice(created.id, altUnit.id), (e) => e.code === 'ALREADY_ASSIGNED');
ok('a police unit can be alerted by hand, live, and the same unit cannot be alerted twice');

// --- assign an ambulance, then watch it move
const first = recs.ambulances.find((a) => a.plate_number === 'ADX-1001') || recs.ambulances[0];
const other = recs.ambulances.find((a) => a.id !== first.id);
const assigned = await api.assignAmbulance(created.id, { ambulanceId: first.id });
assert.equal(assigned.assignment.ambulance.ambulance_id, first.id);
assert.equal(typeof assigned.assignment.ambulance.eta_minutes, 'number');
ok(`ambulance ${assigned.assignment.ambulance.plate_number} assigned with an ETA`);

const crewEmail = first.plate_number === 'ADX-1002' ? 'ambulance2@roadlink.zw' : 'ambulance1@roadlink.zw';
const crew = (await login(crewEmail)).token;
assert.equal((await raw('PATCH', '/ambulances/me/location', crew, { lat: -17.84, lng: 31.04 })).status, 204);
const moved = await waitFor('resource:location', () => moves.find((m) => m.kind === 'ambulance' && m.id === first.id));
assert.ok(typeof moved.lat === 'number' && typeof moved.lng === 'number');
ok('the crew\'s position update reaches the map live');

// --- replacing a crew that is already on scene must be a deliberate act
assert.equal((await raw('POST', `/incidents/${created.id}/ambulance/status`, crew, { status: 'enRoute' })).status, 200);
assert.equal((await raw('POST', `/incidents/${created.id}/ambulance/status`, crew, { status: 'onScene' })).status, 200);
await assert.rejects(() => api.assignAmbulance(created.id, { ambulanceId: other.id }), (e) => e.code === 'AMBULANCE_ON_JOB');
const forced = await api.assignAmbulance(created.id, { ambulanceId: other.id, force: true });
assert.equal(forced.assignment.ambulance.ambulance_id, other.id);
ok('replacing an on-scene crew is refused (AMBULANCE_ON_JOB) unless forced');

// --- hospital
const hosp = recs.hospitals.find((h) => h.has_capacity) || recs.hospitals[0];
const withHospital = await api.assignHospital(created.id, hosp.id);
assert.equal(withHospital.assignment.hospital.hospital_id, hosp.id);
assert.ok(withHospital.assignment.hospital.name);
await waitFor('hospital_notified', () => events.find((e) => e.incident.id === created.id && e.event === 'hospital_notified'));
ok(`${withHospital.assignment.hospital.name} assigned and notified live`);

// --- closing
await assert.rejects(() => api.close(created.id, 'completed'), (e) => e.code === 'NOT_ADMITTED');
const closed = await api.close(created.id, 'no_transport', 'contract check');
assert.equal(closed.status, 'closed');
assert.ok(closed.closed_at);
assert.ok((await api.listIncidents('all', 100)).find((i) => i.id === created.id).status === 'closed');
ok('"completed" is refused before admission; "no transport" closes the incident');

const timeline = await api.timeline(created.id);
assert.ok(timeline.length >= 5 && timeline.every((r) => r.event && r.created_at));
ok(`timeline has ${timeline.length} entries with events and times`);

// --- who may and may not use these endpoints
assert.equal((await raw('GET', '/incidents?status=all', null)).status, 401);
const created2 = await api.createReport({ lat: -17.9, lng: 31.1, severity: 'minor', victim_count: 1 });
assert.equal((await raw('POST', `/incidents/${created2.id}/ambulance`, crew, {})).status, 403);
await api.close(created2.id, 'false_alarm');
ok('signed-out users get 401 and an ambulance crew cannot dispatch (403)');

// --- administration, as an administrator
const adminLogin = await api.login('admin@roadlink.zw', PASSWORD);
assert.equal(adminLogin.user.role, 'admin');
token = adminLogin.token;
const tag = String(Date.now()).slice(-6);

const newAmb = await api.createAmbulance({ plate_number: `ZZ-${tag}`, provider: 'Contract Check' });
assert.ok(newAmb.id);
assert.ok((await api.adminAmbulances()).some((a) => a.id === newAmb.id && a.is_active === true));
await api.updateAmbulance(newAmb.id, { is_active: false });
assert.ok((await api.adminAmbulances()).some((a) => a.id === newAmb.id && a.is_active === false), 'a switched-off ambulance is still listed for the administrator');
assert.ok(!(await api.ambulances()).some((a) => a.id === newAmb.id), 'and hidden from dispatch');
ok('administrator adds an ambulance, switches it off, and still sees it in the full list');

const newUnit = await api.createPoliceUnit({ name: `Contract Unit ${tag}`, station: 'Test' });
await api.updatePoliceUnit(newUnit.id, { is_active: false });
const newHosp = await api.createHospital({ name: `Contract Clinic ${tag}`, lat: -17.8, lng: 31.0, trauma_bays_total: 4, trauma_bays_free: 2, contact_number: '+263 4 000000' });
assert.ok((await api.adminHospitals()).some((h) => h.id === newHosp.id));
await api.updateHospital(newHosp.id, { is_active: false });
ok('administrator adds and switches off a police unit and a hospital');

const newUser = await api.createUser({ name: `Contract User ${tag}`, role: 'dispatcher', email: `contract.${tag}@roadlink.zw`, password: 'contract-pass-1' });
assert.ok(newUser.id && newUser.role === 'dispatcher');
assert.ok((await api.adminUsers()).some((u) => u.id === newUser.id));
await api.updateUser(newUser.id, { password: 'contract-pass-2' });
assert.equal((await raw('POST', '/auth/login', null, { identifier: `contract.${tag}@roadlink.zw`, password: 'contract-pass-2' })).status, 200);
await api.updateUser(newUser.id, { is_active: false });
assert.equal((await raw('POST', '/auth/login', null, { identifier: `contract.${tag}@roadlink.zw`, password: 'contract-pass-2' })).status, 401, 'a disabled account cannot sign in');
ok('administrator creates an account, resets its password, disables it, and it can no longer sign in');

const summary = await api.summary(new Date(Date.now() - 7 * 86400000).toISOString());
for (const f of ['total_incidents', 'closed_incidents', 'avg_report_to_police_on_scene_s', 'avg_report_to_ambulance_assigned_s', 'avg_ambulance_assigned_to_on_scene_s', 'avg_report_to_hospital_admission_s', 'by_severity', 'by_source']) assert.ok(f in summary, `summary needs ${f}`);
assert.ok(summary.total_incidents >= 1 && Array.isArray(summary.by_severity));
assert.equal(typeof summary.avg_report_to_ambulance_assigned_s, 'number', 'the incident we just dispatched has an ambulance-assigned time');
ok(`summary report works (${summary.total_incidents} incidents; report to ambulance assigned averaged ${summary.avg_report_to_ambulance_assigned_s} s)`);

// a dispatcher must not reach any of it
token = me.token;
await assert.rejects(() => api.adminUsers(), (e) => e.status === 403);
await assert.rejects(() => api.summary(new Date().toISOString()), (e) => e.status === 403);
assert.ok(!(await raw('GET', '/ambulances?all=1', me.token)).body.ambulances.some((a) => a.id === newAmb.id), '?all=1 is ignored for dispatchers');
ok('dispatchers get 403 on every admin endpoint, and ?all=1 does nothing for them');

rt.close();
console.log('\nAll dispatch contract checks passed.');
process.exit(0);
