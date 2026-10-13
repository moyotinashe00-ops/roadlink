const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { badRequest, notFound } = require('../middleware/errors');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

const uuidParam = validate(z.object({ id: z.uuid() }), 'params');
const SELECT_POINT = 'ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng';
const pointSql = (i, j) => `ST_SetSRID(ST_MakePoint($${i}, $${j}), 4326)::geography`;

/** Build "UPDATE ... SET a=$2, b=$3" from only the fields the client sent (whitelisted by `allowed`). */
function buildUpdate(body, allowed) {
  const sets = []; const params = [];
  for (const col of allowed) {
    if (body[col] !== undefined) { params.push(body[col]); sets.push(`${col} = $${params.length + 1}`); }
  }
  if (body.lat !== undefined && body.lng !== undefined) {
    params.push(body.lng, body.lat);
    sets.push(`location = ${pointSql(params.length, params.length + 1)}`);
  }
  if (!sets.length) throw badRequest('Nothing to update');
  return { sets: sets.join(', '), params };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
const userBase = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().optional(),
  phone: z.string().trim().regex(/^\+?[0-9 ]{7,16}$/).optional(),
  role: z.enum(['dispatcher', 'police', 'ambulance', 'hospital', 'admin']),
  hospital_id: z.uuid().optional(),
  police_unit_id: z.uuid().optional(),
  ambulance_id: z.uuid().optional(),
});

router.post('/users', validate(userBase.extend({ password: z.string().min(8).max(200) })), async (req, res) => {
  const b = req.valid.body;
  if (!b.email && !b.phone) throw badRequest('Provide an email or a phone number');
  const { rows } = await query(
    `INSERT INTO users (name, email, phone, password_hash, role, hospital_id, police_unit_id, ambulance_id)
     VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8)
     RETURNING id, name, email, phone, role, hospital_id, police_unit_id, ambulance_id, is_active, created_at`,
    [b.name, b.email ?? null, b.phone ?? null, await bcrypt.hash(b.password, 10), b.role, b.hospital_id ?? null, b.police_unit_id ?? null, b.ambulance_id ?? null]);
  res.status(201).json(rows[0]);
});

router.get('/users', async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, email, phone, role, hospital_id, police_unit_id, ambulance_id, is_active, created_at FROM users ORDER BY created_at DESC`);
  res.json({ users: rows });
});

// Accounts are deactivated, never deleted, so the audit trail keeps pointing at a real person.
router.patch('/users/:id', uuidParam,
  validate(z.object({ name: z.string().trim().min(2).max(120).optional(), is_active: z.boolean().optional(), password: z.string().min(8).max(200).optional() })),
  async (req, res) => {
    const b = { ...req.valid.body };
    if (b.password) { b.password_hash = await bcrypt.hash(b.password, 10); delete b.password; }
    if (req.params.id === req.user.id && b.is_active === false) throw badRequest('You cannot deactivate your own account');
    const { sets, params } = buildUpdate(b, ['name', 'is_active', 'password_hash']);
    const { rows } = await query(
      `UPDATE users SET ${sets} WHERE id = $1 RETURNING id, name, email, phone, role, is_active`, [req.params.id, ...params]);
    if (!rows[0]) throw notFound('User not found');
    res.json(rows[0]);
  });

// ---------------------------------------------------------------------------
// Hospitals / ambulances / police units
// ---------------------------------------------------------------------------
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

router.post('/hospitals',
  validate(z.object({ name: z.string().trim().min(2).max(160), lat, lng, contact_number: z.string().trim().max(30).optional(),
    trauma_bays_total: z.number().int().min(0).default(0), trauma_bays_free: z.number().int().min(0).default(0) })
    .refine((b) => b.trauma_bays_free <= b.trauma_bays_total, 'Free bays cannot exceed total bays')),
  async (req, res) => {
    const b = req.valid.body;
    const { rows } = await query(
      `INSERT INTO hospitals (name, location, contact_number, trauma_bays_total, trauma_bays_free)
       VALUES ($1, ${pointSql(2, 3)}, $4, $5, $6) RETURNING id, name, contact_number, trauma_bays_total, trauma_bays_free, ${SELECT_POINT}`,
      [b.name, b.lng, b.lat, b.contact_number ?? null, b.trauma_bays_total, b.trauma_bays_free]);
    res.status(201).json(rows[0]);
  });

router.patch('/hospitals/:id', uuidParam,
  validate(z.object({ name: z.string().trim().min(2).max(160).optional(), contact_number: z.string().trim().max(30).optional(),
    is_active: z.boolean().optional(), lat: lat.optional(), lng: lng.optional() })),
  async (req, res) => {
    const { sets, params } = buildUpdate(req.valid.body, ['name', 'contact_number', 'is_active']);
    const { rows } = await query(`UPDATE hospitals SET ${sets} WHERE id = $1 RETURNING id, name, is_active, ${SELECT_POINT}`, [req.params.id, ...params]);
    if (!rows[0]) throw notFound('Hospital not found');
    res.json(rows[0]);
  });

router.post('/ambulances',
  validate(z.object({ plate_number: z.string().trim().min(3).max(20), provider: z.string().trim().max(120).optional(), lat: lat.optional(), lng: lng.optional() })),
  async (req, res) => {
    const b = req.valid.body;
    const hasLoc = b.lat !== undefined && b.lng !== undefined;
    const { rows } = await query(
      `INSERT INTO ambulances (plate_number, provider, location, location_updated_at)
       VALUES ($1, $2, ${hasLoc ? pointSql(3, 4) : 'NULL'}, ${hasLoc ? 'now()' : 'NULL'})
       RETURNING id, plate_number, provider, is_available`,
      hasLoc ? [b.plate_number, b.provider ?? null, b.lng, b.lat] : [b.plate_number, b.provider ?? null]);
    res.status(201).json(rows[0]);
  });

router.patch('/ambulances/:id', uuidParam,
  validate(z.object({ provider: z.string().trim().max(120).optional(), is_active: z.boolean().optional() })),
  async (req, res) => {
    const { sets, params } = buildUpdate(req.valid.body, ['provider', 'is_active']);
    const { rows } = await query(`UPDATE ambulances SET ${sets} WHERE id = $1 RETURNING id, plate_number, provider, is_active`, [req.params.id, ...params]);
    if (!rows[0]) throw notFound('Ambulance not found');
    res.json(rows[0]);
  });

router.post('/police-units',
  validate(z.object({ name: z.string().trim().min(2).max(160), station: z.string().trim().max(120).optional(), coverage_area: z.string().trim().max(200).optional(), lat: lat.optional(), lng: lng.optional() })),
  async (req, res) => {
    const b = req.valid.body;
    const hasLoc = b.lat !== undefined && b.lng !== undefined;
    const { rows } = await query(
      `INSERT INTO police_units (name, station, coverage_area, location, location_updated_at)
       VALUES ($1, $2, $3, ${hasLoc ? pointSql(4, 5) : 'NULL'}, ${hasLoc ? 'now()' : 'NULL'})
       RETURNING id, name, station, coverage_area, is_available`,
      hasLoc ? [b.name, b.station ?? null, b.coverage_area ?? null, b.lng, b.lat] : [b.name, b.station ?? null, b.coverage_area ?? null]);
    res.status(201).json(rows[0]);
  });

router.patch('/police-units/:id', uuidParam,
  validate(z.object({ station: z.string().trim().max(120).optional(), coverage_area: z.string().trim().max(200).optional(), is_active: z.boolean().optional() })),
  async (req, res) => {
    const { sets, params } = buildUpdate(req.valid.body, ['station', 'coverage_area', 'is_active']);
    const { rows } = await query(`UPDATE police_units SET ${sets} WHERE id = $1 RETURNING id, name, station, coverage_area, is_active`, [req.params.id, ...params]);
    if (!rows[0]) throw notFound('Police unit not found');
    res.json(rows[0]);
  });

// ---------------------------------------------------------------------------
// Reports (ADM-05): response-time analytics derived from the audit trail
// ---------------------------------------------------------------------------
router.get('/reports/summary',
  validate(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), 'query'),
  async (req, res) => {
    const from = req.valid.query.from || new Date(Date.now() - 30 * 86400000);
    const to = req.valid.query.to || new Date(Date.now() + 86400000);

    const times = await query(
      `WITH t AS (
         SELECT i.id, i.status, i.created_at,
           MIN(su.created_at) FILTER (WHERE su.event = 'police_notified')      AS police_notified,
           MIN(su.created_at) FILTER (WHERE su.event = 'police_on_scene')      AS police_on_scene,
           MIN(su.created_at) FILTER (WHERE su.event = 'ambulance_assigned')   AS amb_assigned,
           MIN(su.created_at) FILTER (WHERE su.event = 'ambulance_on_scene')   AS amb_on_scene,
           MIN(su.created_at) FILTER (WHERE su.event = 'patient_admitted')     AS admitted
         FROM incidents i JOIN status_updates su ON su.incident_id = i.id
         WHERE i.created_at >= $1 AND i.created_at < $2
         GROUP BY i.id)
       SELECT count(*)::int AS total_incidents,
         count(*) FILTER (WHERE status = 'closed')::int AS closed_incidents,
         round(avg(extract(epoch FROM (police_on_scene - created_at))))::int AS avg_report_to_police_on_scene_s,
         round(avg(extract(epoch FROM (amb_assigned - created_at))))::int    AS avg_report_to_ambulance_assigned_s,
         round(avg(extract(epoch FROM (amb_on_scene - amb_assigned))))::int  AS avg_ambulance_assigned_to_on_scene_s,
         round(avg(extract(epoch FROM (admitted - created_at))))::int        AS avg_report_to_hospital_admission_s
       FROM t`, [from, to]);

    const bySeverity = await query(`SELECT severity, count(*)::int AS count FROM incidents WHERE created_at >= $1 AND created_at < $2 GROUP BY severity ORDER BY severity`, [from, to]);
    const bySource = await query(`SELECT source, count(*)::int AS count FROM incidents WHERE created_at >= $1 AND created_at < $2 GROUP BY source ORDER BY source`, [from, to]);

    res.json({ period: { from, to }, ...times.rows[0], by_severity: bySeverity.rows, by_source: bySource.rows });
  });

module.exports = router;
