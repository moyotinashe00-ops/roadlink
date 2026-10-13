const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { userFromToken } = require('../middleware/auth');
const { getIncidentForUser } = require('../services/incidentService');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CITIZEN_WATCHES = 5;

/**
 * Realtime layer. Two kinds of client:
 *  - Staff: connect with { auth: { token } } and are auto-subscribed to the rooms their role may see.
 *  - Citizens (the Reporter app): connect with no token and emit 'watch' with the incident id they
 *    were given. They only ever receive the minimal public view of that one incident.
 */
function attach(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigins.length ? config.corsOrigins : '*' },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) { socket.data.user = null; return next(); }
    try {
      socket.data.user = await userFromToken(token);
      const { exp } = jwt.decode(token) || {};
      socket.data.exp = exp;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;

    if (user) {
      socket.join(`role:${user.role}`);
      if (user.police_unit_id) socket.join(`police:${user.police_unit_id}`);
      if (user.ambulance_id) socket.join(`ambulance:${user.ambulance_id}`);
      if (user.hospital_id) socket.join(`hospital:${user.hospital_id}`);

      // An expired token must not keep a live feed open indefinitely.
      if (socket.data.exp) {
        const ms = socket.data.exp * 1000 - Date.now();
        const t = setTimeout(() => { socket.emit('auth:expired'); socket.disconnect(true); }, Math.max(ms, 0));
        socket.on('disconnect', () => clearTimeout(t));
      }
    }

    // Citizen subscription: watch(incidentId, ack)
    socket.on('watch', async (incidentId, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (typeof incidentId !== 'string' || !UUID.test(incidentId)) return reply({ error: 'Invalid incident id' });
      if (!user) {
        const watching = [...socket.rooms].filter((r) => r.startsWith('incident:')).length;
        if (watching >= MAX_CITIZEN_WATCHES) return reply({ error: 'Too many incidents watched' });
      }
      try {
        const current = await getIncidentForUser(incidentId, null); // public view only, regardless of who asks
        socket.join(`incident:${incidentId}`);
        reply({ ok: true, incident: current });
      } catch {
        reply({ error: 'Incident not found' });
      }
    });

    socket.on('unwatch', (incidentId) => {
      if (typeof incidentId === 'string') socket.leave(`incident:${incidentId}`);
    });
  });

  return io;
}

module.exports = { attach };
