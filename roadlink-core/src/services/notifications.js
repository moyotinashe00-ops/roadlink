const config = require('../config');
const { query } = require('../db');
const { publicView, staffView } = require('./views');

let io = null;
let fcm = null; // firebase-admin messaging instance, or false if unavailable

function init(socketServer) {
  io = socketServer;
}

// ---------------------------------------------------------------------------
// Socket.IO fan-out. Rooms (see realtime/socket.js):
//   role:dispatcher, role:admin       -> every incident
//   police:<id>, ambulance:<id>, hospital:<id> -> only incidents assigned to that resource
//   incident:<id>                      -> the citizen who filed it (public view only)
// ---------------------------------------------------------------------------
function fanout(row, event, name = 'incident:update') {
  if (!io || !row) return;

  const full = staffView(row, 'dispatcher'); // includes reporter phone
  const scoped = staffView(row, 'resource'); // reporter phone removed

  io.to('role:dispatcher').to('role:admin').emit(name, { event, incident: full });
  if (row.police_unit_id) io.to(`police:${row.police_unit_id}`).emit(name, { event, incident: scoped });
  if (row.ambulance_id) io.to(`ambulance:${row.ambulance_id}`).emit(name, { event, incident: scoped });
  if (row.hospital_id) io.to(`hospital:${row.hospital_id}`).emit(name, { event, incident: scoped });
  io.to(`incident:${row.id}`).emit(name, { event, incident: publicView(row) });
}

/** A previously-assigned resource must also hear that it was un-assigned. */
function tellResource(kind, resourceId, name, payload) {
  if (io && resourceId) io.to(`${kind}:${resourceId}`).emit(name, payload);
}

function broadcastToDispatch(name, payload) {
  if (io) io.to('role:dispatcher').to('role:admin').emit(name, payload);
}

// ---------------------------------------------------------------------------
// Push notifications (Firebase Cloud Messaging)
// ---------------------------------------------------------------------------
function getFcm() {
  if (fcm !== null) return fcm;
  if (!config.firebaseServiceAccountJson) {
    fcm = false;
    return fcm;
  }
  try {
    const admin = require('firebase-admin');
    const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(config.firebaseServiceAccountJson)) });
    fcm = admin.messaging(app);
  } catch (err) {
    console.error('[push] Firebase init failed, pushes will be logged only:', err.message);
    fcm = false;
  }
  return fcm;
}

/**
 * Push a notification to every active staff user bound to a resource.
 * `kind` is one of 'police' | 'ambulance' | 'hospital'.
 * Push is best-effort: it never throws into the request that triggered it.
 */
async function pushToResource(kind, resourceId, { title, body, data = {} }) {
  if (!resourceId) return;
  const column = { police: 'police_unit_id', ambulance: 'ambulance_id', hospital: 'hospital_id' }[kind];
  if (!column) return;
  try {
    const { rows } = await query(
      `SELECT id, fcm_token FROM users WHERE ${column} = $1 AND is_active AND fcm_token IS NOT NULL`, [resourceId]);
    if (!rows.length) return;

    const messaging = getFcm();
    if (!messaging) {
      if (config.env !== 'test') console.log(`[push:dry-run] -> ${kind}:${resourceId} (${rows.length} device(s)): ${title} — ${body}`);
      return;
    }
    const stringData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
    const res = await messaging.sendEachForMulticast({
      tokens: rows.map((r) => r.fcm_token),
      notification: { title, body },
      data: stringData,
      android: { priority: 'high' },
    });
    // Drop tokens FCM says are dead so we stop paying for failures.
    const dead = [];
    res.responses.forEach((r, i) => {
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') dead.push(rows[i].fcm_token);
    });
    if (dead.length) await query('UPDATE users SET fcm_token = NULL WHERE fcm_token = ANY($1::text[])', [dead]);
  } catch (err) {
    console.error('[push] failed:', err.message);
  }
}

module.exports = { init, fanout, tellResource, broadcastToDispatch, pushToResource };
