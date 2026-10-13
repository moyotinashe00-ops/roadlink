// Drives the portal's REAL api.js / realtime.js / board.js against a running RoadLink Core
// (no mocks), to prove the field names and events the UI depends on exist on the wire.
//
//   1. in roadlink-core:  npm run db:seed && npm start        (demo accounts must exist)
//   2. here:              CONTRACT_API_URL=http://localhost:3000 npm run contract
import assert from 'node:assert/strict';
import { createApi } from '../src/lib/api.js';
import { connectRealtime } from '../src/lib/realtime.js';
import { groupBoard, setAll, initialBoard } from '../src/lib/board.js';

const BASE = process.env.CONTRACT_API_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_PASSWORD || 'ChangeMe123!';
const raw = async (method, path, token, body) => {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = res.status === 204 ? null : await res.json();
  assert.ok(res.ok, `${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
};
const step = (m) => console.log(`✓ ${m}`);

// --- sign in through the portal's own client
let token = null;
const api = createApi({ baseUrl: BASE, getToken: () => token });
const session = await api.login('hospital2@roadlink.zw', PASSWORD);
token = session.token;
assert.equal(session.user.role, 'hospital');
step(`portal login works (${session.user.name})`);

// --- live feed
const seen = [];
let online;
const connected = new Promise((r) => { online = r; });
const rt = connectRealtime({ baseUrl: BASE, token, onEvent: (e) => seen.push(e), onStatus: (s) => s === 'online' && online() });
await Promise.race([connected, new Promise((_, rej) => setTimeout(() => rej(new Error('socket never connected')), 4000))]);
step('realtime socket connected with the hospital token');

// --- dispatch side (what the Dispatch console will do) creates and routes an incident
const dispatcher = (await raw('POST', '/auth/login', null, { identifier: 'dispatcher@roadlink.zw', password: PASSWORD })).token;
const hospitals = (await api.hospitals());
const mine = hospitals.find((h) => h.id === session.user.hospital_id);
assert.ok(mine && typeof mine.trauma_bays_free === 'number', 'GET /hospitals must include this hospital with bay counts');
const inc = await raw('POST', '/incidents', null, { lat: -17.8419, lng: 31.0378, severity: 'critical', victim_count: 3, description: 'contract check' });
await raw('POST', `/incidents/${inc.id}/ambulance`, dispatcher, {});
await raw('POST', `/incidents/${inc.id}/hospital`, dispatcher, { hospital_id: mine.id });

// --- the portal receives it live, in the shape the UI renders
const evt = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('no hospital_notified event received')), 4000);
  const tick = setInterval(() => {
    const e = seen.find((x) => x.kind === 'upsert' && x.event === 'hospital_notified' && x.incident.id === inc.id);
    if (e) { clearTimeout(t); clearInterval(tick); resolve(e); }
  }, 50);
});
const h = evt.incident.assignment.hospital;
assert.equal(h.state, 'notified');
for (const k of ['eta_minutes', 'assigned_at', 'name']) assert.ok(h[k] != null, `assignment.hospital.${k} is missing`);
assert.ok(evt.incident.assignment.ambulance.plate_number, 'ambulance plate missing');
assert.equal(evt.incident.reporter_phone, undefined, 'hospital must never receive the reporter phone number');
step('live "hospital_notified" event carries everything the card renders (ETA, plate, state) and no reporter phone');

// --- list endpoint feeds the same board grouping
const list = await api.listIncidents('all', 100);
let g = groupBoard(setAll(initialBoard, list).incidents);
assert.ok(g.incoming.some((i) => i.id === inc.id));
step('GET /incidents places it in the "Incoming" column');

// --- acknowledge -> admit
await api.acknowledge(inc.id);
g = groupBoard(setAll(initialBoard, await api.listIncidents()).incidents);
assert.ok(g.preparing.some((i) => i.id === inc.id));
step('acknowledge moves it to "Preparing"');
await assert.rejects(api.acknowledge(inc.id), (e) => e.status === 409 && e.code === 'BAD_STATE');
step('double acknowledge is refused with a stable error code (BAD_STATE)');
await api.admit(inc.id);
g = groupBoard(setAll(initialBoard, await api.listIncidents()).incidents);
assert.ok(g.done.some((i) => i.id === inc.id));
step('admit moves it to "Recently received"');

// --- capacity
const upd = await api.updateCapacity(0, mine.trauma_bays_total);
assert.equal(upd.trauma_bays_free, 0);
await assert.rejects(api.updateCapacity(99, mine.trauma_bays_total), (e) => e.code === 'BAD_CAPACITY');
await api.updateCapacity(mine.trauma_bays_free, mine.trauma_bays_total);
step('capacity update works and over-capacity is rejected (BAD_CAPACITY)');

// --- audit trail
const tl = await api.timeline(inc.id);
const events = tl.map((e) => e.event);
for (const need of ['incident_created', 'hospital_notified', 'hospital_acknowledged', 'patient_admitted']) assert.ok(events.includes(need), `timeline missing ${need}`);
step('timeline contains the events the drawer labels');

// --- isolation: another hospital's incident never reaches this portal
const otherToken = (await raw('POST', '/auth/login', null, { identifier: 'hospital1@roadlink.zw', password: PASSWORD })).token;
const inc2 = await raw('POST', '/incidents', null, { lat: -17.7, lng: 31.3, severity: 'minor' });
const hospitals2 = await raw('GET', '/hospitals', otherToken);
await raw('POST', `/incidents/${inc2.id}/hospital`, dispatcher, { hospital_id: hospitals2.hospitals.find((x) => x.name.startsWith('Parirenyatwa')).id });
await new Promise((r) => setTimeout(r, 500));
assert.ok(!seen.some((e) => e.kind === 'upsert' && e.incident.id === inc2.id), 'received another hospital\'s incident!');
assert.ok(!(await api.listIncidents()).some((i) => i.id === inc2.id));
step("another hospital's incident never reaches this portal (socket or REST)");

rt.close();
console.log('\nAll contract checks passed.');
process.exit(0);
