const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let srv; let T;
const KEY = 'test-ussd-secret';
const ussd = (text, key = KEY) =>
  srv.request.post(`/api/v1/ussd?key=${key}`).type('form').send({ sessionId: 's1', serviceCode: '*123#', phoneNumber: '+263771234567', text });

before(async () => { await h.resetDb(); srv = await h.startServer(); T = await h.loginAll(srv.request); });
after(async () => { await srv.close(); await h.pool.end(); });

test('rejects callers without the shared secret', async () => {
  assert.equal((await ussd('', 'wrong')).status, 403);
  assert.equal((await srv.request.post('/api/v1/ussd').type('form').send({ text: '' })).status, 403);
});

test('menu walks area -> victims -> severity and files an approximate-location incident', async () => {
  const m0 = await ussd('');
  assert.match(m0.text, /^CON /);
  assert.match(m0.text, /1\. Harare CBD/);
  assert.match(m0.text, /0\. Other place/);
  assert.match((await ussd('1')).text, /^CON How many people are hurt/);
  assert.match((await ussd('1*2')).text, /^CON How serious/);

  const done = await ussd('1*2*3');
  assert.match(done.text, /^END Report received\. Reference RL-\d+/);

  const list = await srv.request.get('/api/v1/incidents').set(h.auth(T.dispatcher));
  assert.equal(list.body.incidents.length, 1);
  const inc = list.body.incidents[0];
  assert.equal(inc.source, 'ussd');
  assert.equal(inc.location_accuracy, 'approximate');
  assert.equal(inc.location_label, 'Harare CBD');
  assert.equal(inc.severity, 'critical');
  assert.equal(inc.victim_count, 3);
  assert.equal(inc.reporter_phone, '+263771234567');   // so the dispatcher can call back to confirm the spot
  assert.equal(inc.status, 'policeNotified');
});

test('a second USSD report for the same area is merged, not duplicated', async () => {
  const again = await ussd('1*1*1');
  assert.match(again.text, /already reported by others/);
  assert.equal((await srv.request.get('/api/v1/incidents').set(h.auth(T.dispatcher))).body.incidents.length, 1);
});

test('invalid answers end the session cleanly', async () => {
  assert.match((await ussd('99')).text, /^END Invalid choice/);
  assert.match((await ussd('2*9')).text, /^END Invalid choice/);
  assert.match((await ussd('2*1*9')).text, /^END Invalid choice/);
  assert.match((await ussd('0')).text, /^END Please call/);
});
