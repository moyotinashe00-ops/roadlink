// Administrators can list deactivated vehicles, units and hospitals (?all=1) so they can switch them back on.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let srv;
let T;
const get = (path, token) => srv.request.get(path).set(h.auth(token));

before(async () => { srv = await h.startServer(); });
after(async () => { await srv.close(); await h.pool.end(); });
beforeEach(async () => { await h.resetDb(); T = await h.loginAll(srv.request); });

const ENDPOINTS = [
  ['/api/v1/ambulances', 'ambulances', 'ambulances'],
  ['/api/v1/police-units', 'police_units', 'police_units'],
  ['/api/v1/hospitals', 'hospitals', 'hospitals'],
];

for (const [path, key, table] of ENDPOINTS) {
  test(`${path}: deactivated records are hidden unless an administrator asks for them`, async () => {
    const total = (await h.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    await h.pool.query(`UPDATE ${table} SET is_active = FALSE WHERE id = (SELECT id FROM ${table} LIMIT 1)`);

    const normal = (await get(path, T.dispatcher)).body[key];
    assert.equal(normal.length, total - 1, 'a dispatcher sees only active records');

    const dispatcherAll = (await get(`${path}?all=1`, T.dispatcher)).body[key];
    assert.equal(dispatcherAll.length, total - 1, '?all=1 is ignored for anyone but an administrator');

    const adminAll = (await get(`${path}?all=1`, T.admin)).body[key];
    assert.equal(adminAll.length, total);
    assert.equal(adminAll.filter((r) => r.is_active === false).length, 1);
    assert.ok(adminAll.every((r) => typeof r.is_active === 'boolean'));
  });
}
