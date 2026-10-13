const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db');
const { unauthorized, forbidden } = require('./errors');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

const USER_COLUMNS = `id, name, phone, email, role, hospital_id, police_unit_id, ambulance_id, is_active`;

/** Resolve a bearer token to a live user row (re-checked against the DB so deactivation takes effect immediately). */
async function userFromToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [payload.sub]);
  const user = rows[0];
  if (!user || !user.is_active) throw unauthorized('Account is disabled or no longer exists');
  return user;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Require a valid staff token. */
async function authenticate(req, res, next) {
  const token = bearer(req);
  if (!token) throw unauthorized();
  req.user = await userFromToken(token);
  next();
}

/** Attach req.user if a valid token is present, otherwise continue as anonymous (citizen). */
async function optionalAuth(req, res, next) {
  const token = bearer(req);
  if (token) req.user = await userFromToken(token);
  next();
}

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) throw unauthorized();
  if (!roles.includes(req.user.role)) throw forbidden(`This action is for: ${roles.join(', ')}`);
  next();
};

module.exports = { signToken, userFromToken, authenticate, optionalAuth, requireRole };
