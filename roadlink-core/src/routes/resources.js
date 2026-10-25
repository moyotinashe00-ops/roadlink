const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { conflict } = require('../middleware/errors');
const notify = require('../services/notifications');

const router = express.Router();
router.use(['/hospitals', '/ambulances', '/police-units'], authenticate);

const coords = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const pt = (alias) => `ST_Y(${alias}.location::geometry) AS lat, ST_X(${alias}.location::geometry) AS lng`;

// ---- Hospitals -------------------------------------------------------------
// An administrator can ask for deactivated records too (?all=1), so a vehicle or unit switched off by mistake can be switched on again.
const wantsAll = (req) => req.query.all === '1' && req.user && req.user.role === 'admin';

router.get('/hospitals', async (req, res) => {
  const all = wantsAll(req);
  const { rows } = await query(
    `SELECT h.id, h.name, h.is_active, h.contact_number, h.trauma_bays_total, h.trauma_bays_free, h.capacity_updated_at, ${pt('h')}
     FROM hospitals h WHERE ($1::boolean OR h.is_active) ORDER BY h.name`, [all]);
  res.json({ hospitals: rows });
});

// HOS-05: staff keep the number the dispatcher's hospital ranking uses up to date.
router.patch('/hospitals/me/capacity', requireRole('hospital'),
  validate(z.object({ trauma_bays_free: z.number().int().min(0), trauma_bays_total: z.number().int().min(0).optional() })),
  async (req, res) => {
    const { trauma_bays_free, trauma_bays_total } = req.valid.body;
    const { rows } = await query(
      `UPDATE hospitals SET trauma_bays_free = $2, trauma_bays_total = COALESCE($3, trauma_bays_total), capacity_updated_at = now()
       WHERE id = $1 AND (COALESCE($3, trauma_bays_total) >= $2)
       RETURNING id, name, trauma_bays_free, trauma_bays_total, capacity_updated_at`,
      [req.user.hospital_id, trauma_bays_free, trauma_bays_total ?? null]);
    if (!rows[0]) throw conflict('Free bays cannot exceed total bays', 'BAD_CAPACITY');
    notify.broadcastToDispatch('hospital:capacity', rows[0]);
    res.json(rows[0]);
  });

// ---- Ambulances ------------------------------------------------------------
router.get('/ambulances', requireRole('dispatcher', 'admin'), async (req, res) => {
  const all = wantsAll(req);
  const { rows } = await query(
    `SELECT a.id, a.plate_number, a.provider, a.is_active, a.is_available, a.location_updated_at, ${pt('a')}
     FROM ambulances a WHERE ($1::boolean OR a.is_active) ORDER BY a.plate_number`, [all]);
  res.json({ ambulances: rows });
});

// The crew's own vehicle: the app needs its current on-duty state when it starts.
router.get('/ambulances/me', requireRole('ambulance'), async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.plate_number, a.provider, a.is_available, a.location_updated_at, ${pt('a')} FROM ambulances a WHERE a.id = $1`,
    [req.user.ambulance_id]);
  res.json(rows[0]);
});

router.patch('/ambulances/me/location', requireRole('ambulance'), validate(coords), async (req, res) => {
  const { lat, lng } = req.valid.body;
  await query(
    `UPDATE ambulances SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, location_updated_at = now() WHERE id = $1`,
    [req.user.ambulance_id, lng, lat]);
  notify.broadcastToDispatch('resource:location', { kind: 'ambulance', id: req.user.ambulance_id, lat, lng, at: new Date().toISOString() });
  res.status(204).end();
});

// AMB-06: the crew marks themselves available again — but not while a job is still in progress.
router.patch('/ambulances/me/availability', requireRole('ambulance'),
  validate(z.object({ is_available: z.boolean() })),
  async (req, res) => {
    const { is_available } = req.valid.body;
    if (is_available) {
      const busy = await query(
        `SELECT 1 FROM assignments a JOIN incidents i ON i.id = a.incident_id
         WHERE a.ambulance_id = $1 AND i.status <> 'closed' AND a.ambulance_state IS DISTINCT FROM 'arrived' LIMIT 1`,
        [req.user.ambulance_id]);
      if (busy.rowCount) throw conflict('Finish your current job (mark "arrived") before going available', 'JOB_IN_PROGRESS');
    }
    await query('UPDATE ambulances SET is_available = $2 WHERE id = $1', [req.user.ambulance_id, is_available]);
    res.json({ is_available });
  });

// ---- Police units ----------------------------------------------------------
router.get('/police-units', requireRole('dispatcher', 'admin'), async (req, res) => {
  const all = wantsAll(req);
  const { rows } = await query(
    `SELECT p.id, p.name, p.station, p.coverage_area, p.is_active, p.is_available, p.location_updated_at, ${pt('p')}
     FROM police_units p WHERE ($1::boolean OR p.is_active) ORDER BY p.name`, [all]);
  res.json({ police_units: rows });
});

router.get('/police-units/me', requireRole('police'), async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.name, p.station, p.coverage_area, p.is_available, p.location_updated_at, ${pt('p')} FROM police_units p WHERE p.id = $1`,
    [req.user.police_unit_id]);
  res.json(rows[0]);
});

router.patch('/police-units/me/location', requireRole('police'), validate(coords), async (req, res) => {
  const { lat, lng } = req.valid.body;
  await query(
    `UPDATE police_units SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, location_updated_at = now() WHERE id = $1`,
    [req.user.police_unit_id, lng, lat]);
  notify.broadcastToDispatch('resource:location', { kind: 'police', id: req.user.police_unit_id, lat, lng, at: new Date().toISOString() });
  res.status(204).end();
});

router.patch('/police-units/me/availability', requireRole('police'),
  validate(z.object({ is_available: z.boolean() })),
  async (req, res) => {
    await query('UPDATE police_units SET is_available = $2 WHERE id = $1', [req.user.police_unit_id, req.valid.body.is_available]);
    res.json({ is_available: req.valid.body.is_available });
  });

module.exports = router;
