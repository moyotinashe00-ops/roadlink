const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let srv; let T;
const api = () => srv.request;

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

before(async () => { await h.resetDb(); srv = await h.startServer(); T = await h.loginAll(srv.request); });
after(async () => { await srv.close(); await h.pool.end(); });

describe('authentication', () => {
  test('wrong password / unknown user get the same generic 401', async () => {
    const a = await api().post('/api/v1/auth/login').send({ identifier: 'police1@roadlink.zw', password: 'wrong-password' });
    const b = await api().post('/api/v1/auth/login').send({ identifier: 'nobody@roadlink.zw', password: 'wrong-password' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error.message, b.body.error.message);
  });

  test('login is case-insensitive on email and SQL metacharacters are harmless', async () => {
    const ok = await api().post('/api/v1/auth/login').send({ identifier: 'POLICE1@RoadLink.ZW', password: h.PASSWORD });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.role, 'police');
    assert.equal(ok.body.user.password_hash, undefined);
    const inj = await api().post('/api/v1/auth/login').send({ identifier: "' OR 1=1 --", password: 'x' });
    assert.equal(inj.status, 401);
  });

  test('protected routes need a valid token', async () => {
    assert.equal((await api().get('/api/v1/incidents')).status, 401);
    assert.equal((await api().get('/api/v1/incidents').set('Authorization', 'Bearer nonsense')).status, 401);
    assert.equal((await api().get('/api/v1/hospitals')).status, 401);
  });

  test('deactivating an account revokes its existing token immediately', async () => {
    const users = (await api().get('/api/v1/admin/users').set(h.auth(T.admin))).body.users;
    const p2 = users.find((u) => u.email === 'police2@roadlink.zw');
    assert.equal((await api().get('/api/v1/incidents').set(h.auth(T.police2))).status, 200);
    const off = await api().patch(`/api/v1/admin/users/${p2.id}`).set(h.auth(T.admin)).send({ is_active: false });
    assert.equal(off.status, 200);
    assert.equal((await api().get('/api/v1/incidents').set(h.auth(T.police2))).status, 401);
    assert.equal((await api().post('/api/v1/auth/login').send({ identifier: 'police2@roadlink.zw', password: h.PASSWORD })).status, 401);
  });
});

describe('role-based access control', () => {
  test('non-admins cannot use admin endpoints; staff cannot file as citizens', async () => {
    for (const t of [T.dispatcher, T.police1, T.amb1, T.hosp1]) {
      assert.equal((await api().get('/api/v1/admin/users').set(h.auth(t))).status, 403);
    }
    const asPolice = await api().post('/api/v1/incidents').set(h.auth(T.police1)).send({ ...h.CBD, severity: 'minor' });
    assert.equal(asPolice.status, 403);
  });

  test('an ambulance crew cannot dispatch, a dispatcher cannot admit patients', async () => {
    const made = await api().post('/api/v1/incidents').send({ ...h.CBD, severity: 'minor' });
    const id = made.body.id;
    assert.equal((await api().post(`/api/v1/incidents/${id}/ambulance`).set(h.auth(T.amb1)).send({})).status, 403);
    assert.equal((await api().post(`/api/v1/incidents/${id}/hospital/admit`).set(h.auth(T.dispatcher))).status, 403);
    // a police officer from another unit cannot even read it
    assert.equal((await api().get(`/api/v1/incidents/${id}`).set(h.auth(T.hosp1))).status, 403);
    assert.equal((await api().get(`/api/v1/incidents/${id}/timeline`).set(h.auth(T.amb1))).status, 403);
  });

  test('reporter phone is visible to dispatch only', async () => {
    const made = await api().post('/api/v1/incidents').set(h.auth(T.dispatcher))
      .send({ lat: -17.9, lng: 31.1, severity: 'serious', victim_count: 2, reporter_phone: '+263771234567', description: 'Phoned in' });
    assert.equal(made.status, 201);
    assert.equal(made.body.source, 'voice');
    assert.equal(made.body.location_accuracy, 'approximate');
    assert.equal(made.body.reporter_phone, '+263771234567');
    const id = made.body.id;
    assert.equal((await api().get(`/api/v1/incidents/${id}`)).body.reporter_phone, undefined);
    assert.equal((await api().get(`/api/v1/incidents/${id}`).set(h.auth(T.dispatcher))).body.reporter_phone, '+263771234567');
  });
});

describe('input validation', () => {
  const bad = [
    ['missing severity', { lat: -17.8, lng: 31 }],
    ['unknown severity', { lat: -17.8, lng: 31, severity: 'apocalyptic' }],
    ['latitude out of range', { lat: 123, lng: 31, severity: 'minor' }],
    ['non-numeric coordinates', { lat: 'abc', lng: 31, severity: 'minor' }],
    ['negative victims', { lat: -17.8, lng: 31, severity: 'minor', victim_count: -1 }],
    ['absurd victims', { lat: -17.8, lng: 31, severity: 'minor', victim_count: 100000 }],
    ['oversized description', { lat: -17.8, lng: 31, severity: 'minor', description: 'x'.repeat(501) }],
  ];
  for (const [name, body] of bad) {
    test(`rejects ${name}`, async () => {
      const res = await api().post('/api/v1/incidents').send(body);
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'VALIDATION');
    });
  }

  test('malformed JSON gives a clean 400, not a stack trace', async () => {
    const res = await api().post('/api/v1/incidents').set('Content-Type', 'application/json').send('{"lat": ');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'BAD_JSON');
  });

  test('optional geofence rejects reports outside Zimbabwe', async () => {
    h.config.geofenceZw = true;
    try {
      const out = await api().post('/api/v1/incidents').send({ lat: 37.42, lng: -122.08, severity: 'minor' }); // Mountain View
      assert.equal(out.status, 422);
      assert.equal(out.body.error.code, 'OUTSIDE_SERVICE_AREA');
      const inside = await api().post('/api/v1/incidents').send({ lat: -20.15, lng: 28.58, severity: 'minor' }); // Bulawayo
      assert.equal(inside.status, 201);
    } finally { h.config.geofenceZw = false; }
  });
});

describe('photo upload', () => {
  let id;
  before(async () => { id = (await api().post('/api/v1/incidents').send({ lat: -17.7, lng: 31.2, severity: 'minor' })).body.id; });

  test('rejects a non-image disguised with an image content-type', async () => {
    const res = await api().post(`/api/v1/incidents/${id}/photo`)
      .attach('photo', Buffer.from('<?php echo "pwned"; ?>'), { filename: 'evil.png', contentType: 'image/png' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'BAD_IMAGE');
  });

  test('rejects disallowed types and oversized files', async () => {
    const svg = await api().post(`/api/v1/incidents/${id}/photo`)
      .attach('photo', Buffer.from('<svg/>'), { filename: 'a.svg', contentType: 'image/svg+xml' });
    assert.equal(svg.status, 400);
    const big = await api().post(`/api/v1/incidents/${id}/photo`)
      .attach('photo', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), { filename: 'big.png', contentType: 'image/png' });
    assert.equal(big.status, 413);
  });

  test('accepts a real image; only authorised staff can view it', async () => {
    const ok = await api().post(`/api/v1/incidents/${id}/photo`).attach('photo', PNG, { filename: 'a.png', contentType: 'image/png' });
    assert.equal(ok.status, 201);
    assert.equal((await api().post(`/api/v1/incidents/${id}/photo`).attach('photo', PNG, { filename: 'b.png', contentType: 'image/png' })).status, 409);

    assert.equal((await api().get(`/api/v1/incidents/${id}/photo`)).status, 401);
    assert.equal((await api().get(`/api/v1/incidents/${id}/photo`).set(h.auth(T.hosp1))).status, 403);
    const view = await api().get(`/api/v1/incidents/${id}/photo`).set(h.auth(T.dispatcher));
    assert.equal(view.status, 200);
    assert.match(view.headers['content-type'], /image\/png/);
    // the public view hides the file path and only exposes nothing photo-related
    assert.equal((await api().get(`/api/v1/incidents/${id}`)).body.photo_path, undefined);
  });
});

describe('admin management', () => {
  test('admin creates a user who can then log in; role/resource binding is enforced', async () => {
    const units = (await api().get('/api/v1/police-units').set(h.auth(T.admin))).body.police_units;
    const made = await api().post('/api/v1/admin/users').set(h.auth(T.admin))
      .send({ name: 'Officer New', email: 'new.officer@roadlink.zw', password: 'LongEnough1!', role: 'police', police_unit_id: units[0].id });
    assert.equal(made.status, 201);
    assert.equal(made.body.password_hash, undefined);
    assert.equal((await api().post('/api/v1/auth/login').send({ identifier: 'new.officer@roadlink.zw', password: 'LongEnough1!' })).status, 200);

    const unbound = await api().post('/api/v1/admin/users').set(h.auth(T.admin))
      .send({ name: 'No Unit', email: 'nounit@roadlink.zw', password: 'LongEnough1!', role: 'police' });
    assert.equal(unbound.status, 400);
    const dup = await api().post('/api/v1/admin/users').set(h.auth(T.admin))
      .send({ name: 'Dup', email: 'admin@roadlink.zw', password: 'LongEnough1!', role: 'dispatcher' });
    assert.equal(dup.status, 409);
    assert.equal((await api().post('/api/v1/admin/users').set(h.auth(T.admin)).send({ name: 'Weak', email: 'w@x.zw', password: 'short', role: 'dispatcher' })).status, 400);
  });

  test('an admin cannot deactivate their own account', async () => {
    const me = (await api().get('/api/v1/auth/me').set(h.auth(T.admin))).body.user;
    assert.equal((await api().patch(`/api/v1/admin/users/${me.id}`).set(h.auth(T.admin)).send({ is_active: false })).status, 400);
  });

  test('admin can add a hospital and update a police unit', async () => {
    const hosp = await api().post('/api/v1/admin/hospitals').set(h.auth(T.admin))
      .send({ name: 'Test Clinic', lat: -17.85, lng: 31.05, trauma_bays_total: 3, trauma_bays_free: 2 });
    assert.equal(hosp.status, 201);
    assert.equal(hosp.body.lat, -17.85);
    assert.equal((await api().post('/api/v1/admin/hospitals').set(h.auth(T.admin))
      .send({ name: 'Bad', lat: -17.85, lng: 31.05, trauma_bays_total: 1, trauma_bays_free: 5 })).status, 400);
    const units = (await api().get('/api/v1/police-units').set(h.auth(T.admin))).body.police_units;
    const upd = await api().patch(`/api/v1/admin/police-units/${units[0].id}`).set(h.auth(T.admin)).send({ coverage_area: 'Updated area' });
    assert.equal(upd.body.coverage_area, 'Updated area');
    assert.equal((await api().patch(`/api/v1/admin/police-units/${units[0].id}`).set(h.auth(T.admin)).send({})).status, 400);
  });
});

describe('misc', () => {
  test('health check and unknown routes', async () => {
    assert.deepEqual((await api().get('/health')).body, { status: 'ok' });
    const nf = await api().get('/api/v1/nope');
    assert.equal(nf.status, 404);
    assert.equal(nf.body.error.code, 'NOT_FOUND');
    assert.equal((await api().get('/health')).headers['x-powered-by'], undefined);
  });
});
