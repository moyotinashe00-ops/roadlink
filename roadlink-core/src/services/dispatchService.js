const config = require('../config');
const { estimateMinutes } = require('./geo');

const staleAfterMin = Math.max(1, Math.round(config.staleLocationMin));

const stale = (ts) => (ts ? Date.now() - new Date(ts).getTime() > staleAfterMin * 60000 : true);

/**
 * Ambulance ordering shared by the recommendation list and auto-dispatch: ambulances with a recent
 * position first, then nearest. An ambulance whose last position is hours old is only chosen when no
 * fresher one is free. Expects the aliases `a` (ambulances) and `i` (incidents).
 */
const AMBULANCE_ORDER_SQL = `(a.location_updated_at IS NULL OR a.location_updated_at < now() - make_interval(mins => ${staleAfterMin})),
          a.location <-> i.location`;

/** Nearest police unit to an incident. Prefers available units; falls back to the nearest busy one. */
async function nearestPoliceUnit(db, incidentId, excludeIds = []) {
  const sql = (onlyAvailable) => `
    SELECT p.id, p.name, ST_Distance(p.location, i.location) AS meters, p.is_available
    FROM police_units p, incidents i
    WHERE i.id = $1 AND p.is_active AND p.location IS NOT NULL
      AND NOT (p.id = ANY($2::uuid[]))
      ${onlyAvailable ? 'AND p.is_available' : ''}
    ORDER BY p.location <-> i.location
    LIMIT 1`;
  let { rows } = await db.query(sql(true), [incidentId, excludeIds]);
  if (!rows[0]) ({ rows } = await db.query(sql(false), [incidentId, excludeIds]));
  return rows[0] || null;
}

/** Ranked ambulance recommendations (SRS DIS-02). */
async function recommendAmbulances(db, incidentId, limit = 5) {
  const { rows } = await db.query(
    `SELECT a.id, a.plate_number, a.provider, a.location_updated_at,
            ST_Distance(a.location, i.location) AS meters
     FROM ambulances a, incidents i
     WHERE i.id = $1 AND a.is_active AND a.is_available AND a.location IS NOT NULL
     ORDER BY ${AMBULANCE_ORDER_SQL}
     LIMIT $2`, [incidentId, limit]);
  return rows.map((r) => ({
    id: r.id,
    plate_number: r.plate_number,
    provider: r.provider,
    distance_m: Math.round(r.meters),
    eta_minutes: estimateMinutes(r.meters),
    location_stale: stale(r.location_updated_at),
  }));
}

/** Ranked hospital recommendations (SRS DIS-04): hospitals with free trauma bays first, then by distance. */
async function recommendHospitals(db, incidentId, limit = 5) {
  const { rows } = await db.query(
    `SELECT h.id, h.name, h.contact_number, h.trauma_bays_free, h.trauma_bays_total, h.capacity_updated_at,
            ST_Distance(h.location, i.location) AS meters
     FROM hospitals h, incidents i
     WHERE i.id = $1 AND h.is_active
     ORDER BY (h.trauma_bays_free = 0), ST_Distance(h.location, i.location)
     LIMIT $2`, [incidentId, limit]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    contact_number: r.contact_number,
    trauma_bays_free: r.trauma_bays_free,
    trauma_bays_total: r.trauma_bays_total,
    has_capacity: r.trauma_bays_free > 0,
    distance_m: Math.round(r.meters),
    eta_minutes: estimateMinutes(r.meters),
    capacity_stale: stale(r.capacity_updated_at),
  }));
}

/** Police units for the dispatcher to choose from: available ones first, then nearest. */
async function recommendPolice(db, incidentId, limit = 6) {
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.is_available, p.location_updated_at, ST_Distance(p.location, i.location) AS meters
     FROM police_units p, incidents i
     WHERE i.id = $1 AND p.is_active AND p.location IS NOT NULL
     ORDER BY p.is_available DESC, p.location <-> i.location
     LIMIT $2`, [incidentId, limit]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    is_available: r.is_available,
    distance_m: Math.round(r.meters),
    eta_minutes: estimateMinutes(r.meters),
    location_stale: stale(r.location_updated_at),
  }));
}

module.exports = { AMBULANCE_ORDER_SQL, nearestPoliceUnit, recommendAmbulances, recommendHospitals, recommendPolice };
