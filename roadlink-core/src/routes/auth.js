const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { z } = require('zod');
const config = require('../config');
const { query } = require('../db');
const { signToken, authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { unauthorized, badRequest } = require('../middleware/errors');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
  skip: () => config.env === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } },
});

// Per-account limit, so one password cannot be guessed by rotating IP addresses (and a shared office or
// hospital address is not locked out by one person's typos on another's account).
const accountLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  skip: () => config.env === 'test',
  keyGenerator: (req) => {
    const id = req.body && typeof req.body.identifier === 'string' ? req.body.identifier.trim().toLowerCase().slice(0, 120) : '';
    return id ? `acct:${id}` : ipKeyGenerator(req.ip);
  },
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts on this account. Try again later.' } },
});

// Compared against when the account doesn't exist, so response time doesn't reveal which logins are valid.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role,
  hospital_id: u.hospital_id, police_unit_id: u.police_unit_id, ambulance_id: u.ambulance_id,
});

router.post('/login', loginLimiter, accountLoginLimiter,
  validate(z.object({ identifier: z.string().trim().min(3).max(120), password: z.string().min(1).max(200) })),
  async (req, res) => {
    const { identifier, password } = req.valid.body;
    const { rows } = await query(
      `SELECT * FROM users WHERE (lower(email) = lower($1) OR phone = $1)`, [identifier]);
    const user = rows[0];
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok || !user.is_active) throw unauthorized('Incorrect login details');
    res.json({ token: signToken(user), user: publicUser(user) });
  });

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

// Mobile/web clients register their push token here after login.
router.put('/fcm-token', authenticate,
  validate(z.object({ token: z.string().min(20).max(4096).nullable() })),
  async (req, res) => {
    await query('UPDATE users SET fcm_token = $2 WHERE id = $1', [req.user.id, req.valid.body.token]);
    res.status(204).end();
  });

router.post('/change-password', authenticate,
  validate(z.object({ current_password: z.string().min(1), new_password: z.string().min(8).max(200) })),
  async (req, res) => {
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(req.valid.body.current_password, rows[0].password_hash))) throw badRequest('Current password is incorrect');
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await bcrypt.hash(req.valid.body.new_password, 10)]);
    res.status(204).end();
  });

module.exports = router;
