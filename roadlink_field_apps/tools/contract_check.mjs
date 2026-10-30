// Verifies the Dart field apps against a RUNNING RoadLink Core, using the Dart source as the source of truth:
//   1. every endpoint path in api_client.dart has a real route on the server
//   2. every JSON key models.dart reads exists in real payloads, and keys the Dart code casts as
//      non-nullable (e.g. `as String`) are never null/missing
//   3. the live Socket.IO payloads have the shape realtime.dart parses
//
//   (backend)  npm run db:seed && npm start            (fresh demo data recommended)
//   (here)     CONTRACT_API_URL=http://localhost:3000 npm run contract
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const BASE = process.env.CONTRACT_API_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_PASSWORD || 'ChangeMe123!';
const here = path.dirname(fileURLToPath(import.meta.url));
const shared = path.join(here, '../packages/roadlink_shared/lib/src');
const apiSrc = fs.readFileSync(path.join(shared, 'api_client.dart'), 'utf8');
const modelSrc = fs.readFileSync(path.join(shared, 'models.dart'), 'utf8');

let failures = 0;
let checkpoint = 0;
// A ✓ line is only honest if nothing failed since the previous summary line.
const ok = (m) => { console.log(failures === checkpoint ? `✓ ${m}` : `✗ FAILED: ${m}`); checkpoint = failures; };
const bad = (m) => { failures++; console.log(`  ✗ ${m}`); };

const call = async (method, p, token, body) => {
  const res = await fetch(`${BASE}/api/v1${p}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { /* 204 */ }
  return { status: res.status, json };
};
const must = async (method, p, token, body) => {
  const r = await call(method, p, token, body);
  assert.ok(r.status < 300, `${method} ${p} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};
const login = async (email) => (await must('POST', '/auth/login', null, { identifier: email, password: PASSWORD })).token;

// ---- parse what the Dart code reads --------------------------------------------------------------
/** Returns { ClassName: { key: required(bool) } } from each `fromJson` in models.dart. */
function parseModels(src) {
  const out = {};
  const classRe = /class (\w+) \{[\s\S]*?(?=\nclass |\nenum |\nextension |$)/g;
  for (const m of src.matchAll(classRe)) {
    const [block, name] = [m[0], m[1]];
    const keys = {};
    // direct reads: j['key'] as Type   (required when the cast is non-nullable)
    for (const r of block.matchAll(/j\['(\w+)'\]\s+as\s+(\w+)(\?)?/g)) keys[r[1]] = !r[3];
    // helper reads: _d(j['key']) / _i / _dt are always tolerant of null
    for (const r of block.matchAll(/_(?:d|i|dt)\(j\['(\w+)'\]\)/g)) keys[r[1]] = false;
    if (Object.keys(keys).length) out[name] = keys;
  }
  return out;
}
const MODELS = parseModels(modelSrc);
const need = (cls) => MODELS[cls] || assert.fail(`could not parse ${cls} from models.dart`);

// Keys the Dart code reads as alternatives (`a ?? b`): at least one must be present, not each.
const ANY_OF = { MyResource: [['plate_number', 'name']] };

// Keys the server deliberately sends to some roles ONLY (patient vitals are clinical data: NFR6). The Dart
// model reads them as nullable, so a role that does not get them is fine; the roles listed here MUST get
// the key, and every other role must NOT.
const ROLE_ONLY = { Incident: { latest_vitals: ['ambulance'] } };

function checkKeys(cls, obj, where, role) {
  const groups = ANY_OF[cls] || [];
  for (const g of groups) if (!g.some((k) => k in obj && obj[k] != null)) bad(`${cls}: none of [${g.join(', ')}] present in ${where}`);
  const grouped = new Set(groups.flat());
  for (const [key, required] of Object.entries(need(cls))) {
    if (grouped.has(key)) continue;
    const only = (ROLE_ONLY[cls] || {})[key];
    if (only) {
      if (!role) { bad(`${cls}: \"${key}\" is role-restricted, so ${where} must say which role it is for`); continue; }
      if (only.includes(role) && !(key in obj)) bad(`${cls}: ${role} must receive \"${key}\" but ${where} has no such key`);
      if (!only.includes(role) && key in obj) bad(`${cls}: ${role} must NOT receive \"${key}\" (clinical data) but ${where} contains it`);
      continue;
    }
    if (!(key in obj)) { bad(`${cls}: Dart reads \"${key}\" but ${where} has no such key`); continue; }
    if (required && obj[key] == null) bad(`${cls}: Dart casts \"${key}\" as non-null but ${where} sent null`);
  }
}

// ---- 1. every path in api_client.dart has a route ------------------------------------------------
const roleToken = {}; // filled below
roleToken.police = await login('police1@roadlink.zw');
roleToken.ambulance = await login('ambulance1@roadlink.zw');
const dispatcher = await login('dispatcher@roadlink.zw');

// The route sweep below fires every endpoint (accept, on-scene, clear, decline...), which walks an incident's
// state machine, so it gets its own throw-away incident far from the one used for the workflow checks.
const sweep = await must('POST', '/incidents', null, { lat: -17.95, lng: 31.30, severity: 'minor' });
const SWEEP_ID = sweep.id;

const found = [];
for (const m of apiSrc.matchAll(/_(?:send|incident)\(\s*'(GET|POST|PATCH|PUT)',\s*'([^']+)'/g)) found.push([m[1], m[2]]);
for (const role of ['police-units', 'ambulances']) for (const [mth, sfx] of [['GET', ''], ['PATCH', '/availability'], ['PATCH', '/location']]) found.push([mth, `/${role}/me${sfx}`]);
assert.ok(found.length >= 18, `expected to find the endpoints in api_client.dart, found ${found.length}`);

const bodyFor = (p) => (p.endsWith('/location') ? { lat: -17.8, lng: 31.0 } : p.endsWith('/availability') ? { is_available: true } : {});
let routeCount = 0;
for (const [method, tpl] of found) {
  const p = tpl.replace(/\$id/g, SWEEP_ID).replace(/\$status/g, 'open').replace(/\$\{?_resourcePath\(role\)\}?/g, '/police-units/me');
  const token = p.includes('/ambulance') && !p.includes('/ambulances/me') ? roleToken.ambulance
    : p.startsWith('/ambulances/me') ? roleToken.ambulance : roleToken.police;
  const r = await call(method, p, token, bodyFor(p));
  if (r.status === 404 && String(r.json?.error?.message).startsWith('No route')) bad(`api_client.dart calls ${method} ${tpl} but the server has no such route`);
  else routeCount++;
}
if (!failures) ok(`all ${routeCount} endpoints used by api_client.dart exist on the server`);

// The sweep fired real PATCH /location calls with dummy coordinates and walked the state machine, so put
// the units back where the demo data had them (and free them) before the workflow checks.
await must('PATCH', '/police-units/me/location', roleToken.police, { lat: -17.8290, lng: 31.0522 });
await must('PATCH', '/police-units/me/availability', roleToken.police, { is_available: true });
await must('PATCH', '/ambulances/me/location', roleToken.ambulance, { lat: -17.8310, lng: 31.0480 });
await call('POST', `/incidents/${SWEEP_ID}/close`, dispatcher, { outcome: 'cancelled' });

// ---- 2. real payloads satisfy the Dart models
const seed = await must('POST', '/incidents', null, { lat: -17.8295, lng: 31.0525, severity: 'serious', victim_count: 2, description: 'contract' });
const ID = seed.id;
// ------------------------------------------------------------------------------------------------
// Drive the real workflow: police accept -> on scene -> scene update -> case ref; dispatcher assigns; crew steps.
await must('POST', `/incidents/${ID}/police/accept`, roleToken.police);
await must('POST', `/incidents/${ID}/police/on-scene`, roleToken.police);
await must('PATCH', `/incidents/${ID}/scene`, roleToken.police, { verified_victim_count: 3, hazard_notes: 'Fuel spill', severity: 'critical' });
await must('PUT', `/incidents/${ID}/case-reference`, roleToken.police, { reference_number: 'CR 77/26' });
const hosp = (await must('GET', '/hospitals', dispatcher)).hospitals.find((h) => h.name === 'Harare Central Hospital');
await must('POST', `/incidents/${ID}/ambulance`, dispatcher, {});
await must('POST', `/incidents/${ID}/hospital`, dispatcher, { hospital_id: hosp.id });
await must('POST', `/incidents/${ID}/ambulance/status`, roleToken.ambulance, { status: 'enRoute' });
// the crew records vitals with exactly the body api_client.dart recordVitals() builds
await must('POST', `/incidents/${ID}/ambulance/vitals`, roleToken.ambulance, { pulse_bpm: 112, systolic_bp: 95, diastolic_bp: 60, spo2_percent: 94, consciousness: 'voice' });

for (const [label, token] of [['police', roleToken.police], ['ambulance', roleToken.ambulance]]) {
  const list = (await must('GET', '/incidents?status=open&limit=100', token)).incidents;
  const inc = list.find((i) => i.id === ID);
  assert.ok(inc, `${label} cannot see its own incident in the list`);
  checkKeys('Incident', inc, `${label} incident list`, label);
  if (label === 'ambulance') {
    assert.ok(inc.latest_vitals, 'the crew must get back the vitals it just recorded');
    checkKeys('PatientVitals', inc.latest_vitals, 'ambulance latest_vitals');
    assert.equal(inc.latest_vitals.pulse_bpm, 112);
  }
  if (inc.assignment.police) checkKeys('PoliceAssignment', inc.assignment.police, `${label} assignment.police`);
  if (inc.assignment.ambulance) checkKeys('AmbulanceAssignment', inc.assignment.ambulance, `${label} assignment.ambulance`);
  if (inc.assignment.hospital) {
    checkKeys('HospitalAssignment', inc.assignment.hospital, `${label} assignment.hospital`);
    assert.equal(typeof inc.assignment.hospital.lat, 'number', 'the crew navigates to hospital lat/lng');
  }
  assert.equal(inc.reporter_phone, undefined, `${label} must not receive the reporter phone`);
}
ok('Incident / PoliceAssignment / AmbulanceAssignment / HospitalAssignment keys match real police + ambulance payloads');

const me = await must('POST', '/auth/login', null, { identifier: 'police1@roadlink.zw', password: PASSWORD });
checkKeys('AppUser', me.user, 'login response user');
assert.ok(me.token, 'login must return a token');
checkKeys('AppUser', (await must('GET', '/auth/me', roleToken.police)).user, '/auth/me');
checkKeys('MyResource', await must('GET', '/police-units/me', roleToken.police), '/police-units/me');
checkKeys('MyResource', await must('GET', '/ambulances/me', roleToken.ambulance), '/ambulances/me');
const tl = (await must('GET', `/incidents/${ID}/timeline`, roleToken.police)).timeline;
assert.ok(tl.length >= 5);
checkKeys('TimelineEntry', tl.find((e) => e.actor_name) || tl[0], 'timeline entry');
ok('AppUser / MyResource / TimelineEntry keys match real payloads');

// crew steps exactly as ambulance_job_screen.dart sends them
for (const s of ['onScene', 'transporting', 'arrived']) await must('POST', `/incidents/${ID}/ambulance/status`, roleToken.ambulance, { status: s });
const avail = await must('PATCH', '/ambulances/me/availability', roleToken.ambulance, { is_available: true });
assert.equal(avail.is_available, true);
ok('ambulance steps enRoute→onScene→transporting→arrived, then "Ready for next job", all accepted');

// decline: the Dart code reads `reassigned_to`
// (free police1 first, and report ~600 m from the earlier incident so it is NOT merged as a duplicate)
await must('POST', `/incidents/${ID}/police/clear`, roleToken.police);
const inc2 = await must('POST', '/incidents', null, { lat: -17.8350, lng: 31.0600, severity: 'minor' });
assert.equal(inc2.merged, false, 'expected a separate incident');
const dec = await must('POST', `/incidents/${inc2.id}/police/decline`, roleToken.police, { reason: 'Vehicle unavailable' });
assert.ok('reassigned_to' in dec, 'decline response must carry reassigned_to');
ok('decline returns reassigned_to');

// ---- 3. live socket payloads ---------------------------------------------------------------------
const sock = io(BASE, { auth: { token: roleToken.ambulance }, transports: ['websocket'], forceNew: true });
await new Promise((res, rej) => { sock.once('connect', res); sock.once('connect_error', rej); });
const got = new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no incident:update on the ambulance socket')), 4000); sock.once('incident:update', (p) => { clearTimeout(t); res(p); }); });
const inc3 = await must('POST', '/incidents', null, { lat: -17.9, lng: 31.1, severity: 'minor' });
await must('POST', `/incidents/${inc3.id}/ambulance`, dispatcher, { ambulance_id: (await must('GET', '/ambulances/me', roleToken.ambulance)).id });
const payload = await got;
assert.equal(typeof payload.event, 'string');
checkKeys('Incident', payload.incident, 'socket incident:update payload', 'ambulance');
ok(`socket payload is { event, incident } and parses as an Incident (event="${payload.event}")`);
await must('POST', `/incidents/${inc3.id}/close`, dispatcher, { outcome: 'false_alarm' });
sock.close();
await call('GET', '/health');
ok('socket delivered the assignment to the crew in the shape realtime.dart parses');

console.log(failures ? `\n${failures} CONTRACT PROBLEM(S)` : '\nAll Dart ↔ backend contract checks passed.');
process.exit(failures ? 1 : 0);
