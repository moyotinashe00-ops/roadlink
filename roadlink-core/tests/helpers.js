// Shared test setup. Tests run against a REAL PostgreSQL + PostGIS database
// (nearest-ambulance ranking is PostGIS behaviour, so mocking the DB would prove little).
const path = require('path');
const os = require('os');
const http = require('http');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/roadlink_test';
process.env.JWT_SECRET = 'test-secret';
process.env.USSD_SECRET = 'test-ussd-secret';
process.env.SEED_PASSWORD = 'TestPass123!';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'roadlink-test-uploads');

// The suite TRUNCATEs every table. Never let it near a real database.
const dbName = new URL(process.env.DATABASE_URL).pathname.replace('/', '');
if (!dbName.endsWith('_test')) {
  throw new Error(`Refusing to run tests against "${dbName}": the database name must end in "_test".`);
}

const config = require('../src/config');
const { pool } = require('../src/db');
const { createApp } = require('../src/app');
const { attach } = require('../src/realtime/socket');
const notifications = require('../src/services/notifications');
const { seed } = require('../db/seed');
const supertest = require('supertest');
const { io: ioClient } = require('socket.io-client');

const PASSWORD = process.env.SEED_PASSWORD;

async function resetDb() {
  await pool.query(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'));
  await pool.query(`TRUNCATE status_updates, case_references, assignments, incidents, users,
                    ambulances, police_units, hospitals, known_areas RESTART IDENTITY CASCADE`);
  await pool.query('ALTER SEQUENCE incident_ref_seq RESTART');
  await seed(pool, PASSWORD);
}

/** Boots the real app + Socket.IO on an ephemeral port. */
async function startServer() {
  const app = createApp();
  const server = http.createServer(app);
  const io = attach(server);
  notifications.init(io);
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    app, url, request: supertest(app),
    async close() { io.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); },
  };
}

async function login(request, email) {
  const res = await request.post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function loginAll(request) {
  const emails = {
    admin: 'admin@roadlink.zw', dispatcher: 'dispatcher@roadlink.zw',
    police1: 'police1@roadlink.zw', police2: 'police2@roadlink.zw',
    amb1: 'ambulance1@roadlink.zw', amb2: 'ambulance2@roadlink.zw',
    hosp1: 'hospital1@roadlink.zw', hosp2: 'hospital2@roadlink.zw',
  };
  const out = {};
  for (const [k, e] of Object.entries(emails)) out[k] = await login(request, e);
  return out;
}

const auth = (t) => ({ Authorization: `Bearer ${t}` });

// A point in Harare CBD, ~50 m from the "Harare Central Traffic" police unit and ~400 m from ambulance ADX-1001.
const CBD = { lat: -17.8295, lng: 31.0525 };

function connectSocket(url, token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { auth: token ? { token } : {}, transports: ['websocket'], forceNew: true });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

/** Resolve with the first payload on `event` matching `predicate`, or reject after `ms`. */
function waitFor(socket, event, predicate = () => true, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`timed out waiting for ${event}`)); }, ms);
    function handler(payload) {
      if (predicate(payload)) { clearTimeout(timer); socket.off(event, handler); resolve(payload); }
    }
    socket.on(event, handler);
  });
}

/** Resolve true if NO matching event arrives within `ms` (for "this room must NOT hear it"). */
function expectSilence(socket, event, ms = 400) {
  return new Promise((resolve) => {
    const handler = () => { clearTimeout(timer); resolve(false); };
    const timer = setTimeout(() => { socket.off(event, handler); resolve(true); }, ms);
    socket.once(event, handler);
  });
}

module.exports = { config, pool, resetDb, startServer, login, loginAll, auth, CBD, connectSocket, waitFor, expectSilence, PASSWORD };
