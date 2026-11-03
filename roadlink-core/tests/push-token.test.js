const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let srv; let T;
const api = () => srv.request;
const TOKEN_A = 'fcm-token-for-phone-A-0123456789abcdef';
const TOKEN_B = 'fcm-token-for-phone-B-0123456789abcdef';

before(async () => { await h.resetDb(); srv = await h.startServer(); T = await h.loginAll(srv.request); });
after(async () => { await srv.close(); await h.pool.end(); });

describe('push token registration', () => {
  test('a signed-in user registers their phone, and can replace the token when FCM rotates it', async () => {
    assert.equal((await api().put('/api/v1/auth/fcm-token').set(h.auth(T.police1)).send({ token: TOKEN_A })).status, 204);
    const me = (await h.pool.query("SELECT id FROM users WHERE id = (SELECT id FROM users WHERE fcm_token = $1)", [TOKEN_A])).rows;
    assert.equal(me.length, 1);
    assert.equal((await api().put('/api/v1/auth/fcm-token').set(h.auth(T.police1)).send({ token: TOKEN_B })).status, 204);
    const holders = (await h.pool.query('SELECT count(*)::int AS n FROM users WHERE fcm_token = $1', [TOKEN_B])).rows[0].n;
    assert.equal(holders, 1);
    assert.equal((await h.pool.query('SELECT count(*)::int AS n FROM users WHERE fcm_token = $1', [TOKEN_A])).rows[0].n, 0, 'the old token is replaced');
  });

  test('a phone passed to another account stops receiving the first account\'s alerts', async () => {
    await api().put('/api/v1/auth/fcm-token').set(h.auth(T.police1)).send({ token: TOKEN_A });
    await api().put('/api/v1/auth/fcm-token').set(h.auth(T.police2)).send({ token: TOKEN_A }); // same physical phone
    const rows = (await h.pool.query('SELECT role, fcm_token FROM users WHERE fcm_token = $1', [TOKEN_A])).rows;
    assert.equal(rows.length, 1, 'exactly one account holds the phone');
    const police2Id = (await api().get('/api/v1/auth/me').set(h.auth(T.police2))).body.user.id;
    const holder = (await h.pool.query('SELECT id FROM users WHERE fcm_token = $1', [TOKEN_A])).rows[0].id;
    assert.equal(holder, police2Id, 'the account that registered last');
  });

  test('signing out clears the token, and only for that account', async () => {
    await api().put('/api/v1/auth/fcm-token').set(h.auth(T.amb1)).send({ token: TOKEN_B });
    await api().put('/api/v1/auth/fcm-token').set(h.auth(T.hosp1)).send({ token: 'another-phone-token-0123456789abcdef' });
    assert.equal((await api().delete('/api/v1/auth/fcm-token').set(h.auth(T.amb1))).status, 204);
    const amb = (await api().get('/api/v1/auth/me').set(h.auth(T.amb1))).body.user.id;
    assert.equal((await h.pool.query('SELECT fcm_token FROM users WHERE id = $1', [amb])).rows[0].fcm_token, null);
    assert.equal((await h.pool.query("SELECT count(*)::int AS n FROM users WHERE fcm_token = 'another-phone-token-0123456789abcdef'")).rows[0].n, 1, 'other accounts untouched');
  });

  test('null clears the token too, a too-short token is refused, and a login is required', async () => {
    await api().put('/api/v1/auth/fcm-token').set(h.auth(T.dispatcher)).send({ token: TOKEN_A });
    assert.equal((await api().put('/api/v1/auth/fcm-token').set(h.auth(T.dispatcher)).send({ token: null })).status, 204);
    assert.equal((await api().put('/api/v1/auth/fcm-token').set(h.auth(T.dispatcher)).send({ token: 'short' })).status, 400);
    assert.equal((await api().put('/api/v1/auth/fcm-token').send({ token: TOKEN_A })).status, 401);
    assert.equal((await api().delete('/api/v1/auth/fcm-token')).status, 401);
  });
});
