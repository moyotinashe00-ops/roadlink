const config = require('../config');
const { pool, query, withTransaction } = require('../db');
const { badRequest, forbidden, notFound, conflict } = require('../middleware/errors');
const { nearestPoliceUnit, recommendHospitals } = require('./dispatchService');
const { estimateMinutes } = require('./geo');
const notify = require('./notifications');
const { publicView, staffView } = require('./views');

// Order matters: the headline status only ever moves FORWARD. Police, ambulance and hospital
// progress in parallel, so e.g. "ambulanceAssigned" can arrive before "policeOnScene"; the
// later-but-lower event is still written to the audit trail but never regresses the status
// a citizen sees. These strings are the exact values the Flutter IncidentStatus enum parses.
const STATUS_ORDER = [
  'reported', 'policeNotified', 'policeOnScene', 'ambulanceAssigned', 'ambulanceEnRoute',
  'ambulanceOnScene', 'transporting', 'hospitalNotified', 'admitted', 'closed',
];
const SEVERITY_ORDER = ['minor', 'serious', 'critical', 'fatal'];
const AMBULANCE_STATES = ['assigned', 'enRoute', 'onScene', 'transporting', 'arrived'];
const rank = (list, v) => list.indexOf(v);

const INCIDENT_SELECT = `
  SELECT i.id, i.reference_number,
         ST_Y(i.location::geometry) AS lat, ST_X(i.location::geometry) AS lng,
         i.location_accuracy, i.location_label, i.severity, i.victim_count, i.verified_victim_count,
         i.description, i.hazard_notes, (i.photo_path IS NOT NULL) AS has_photo,
         i.status, i.source, i.reporter_phone, i.report_count, i.created_at, i.updated_at, i.closed_at,
         a.police_unit_id, a.police_state, a.ambulance_id, a.ambulance_state, a.ambulance_eta_minutes,
         a.hospital_id, a.hospital_state, a.hospital_eta_minutes,
         a.hospital_assigned_at, a.ambulance_assigned_at,
         pu.name AS police_unit_name, amb.plate_number AS ambulance_plate, h.name AS hospital_name,
         h.contact_number AS hospital_phone,
         ST_Y(h.location::geometry) AS hospital_lat, ST_X(h.location::geometry) AS hospital_lng,
         cr.reference_number AS case_reference
  FROM incidents i
  LEFT JOIN assignments a      ON a.incident_id = i.id
  LEFT JOIN police_units pu    ON pu.id = a.police_unit_id
  LEFT JOIN ambulances amb     ON amb.id = a.ambulance_id
  LEFT JOIN hospitals h        ON h.id = a.hospital_id
  LEFT JOIN case_references cr ON cr.incident_id = i.id`;

async function getIncidentRow(db, id) {
  const { rows } = await db.query(`${INCIDENT_SELECT} WHERE i.id = $1`, [id]);
  return rows[0] || null;
}

const actorOf = (user, fallbackRole = 'citizen') => ({
  actor_user_id: user ? user.id : null,
  actor_role: user ? user.role : fallbackRole,
});

async function logEvent(db, incidentId, { actor, event, oldStatus, newStatus, note }) {
  await db.query(
    `INSERT INTO status_updates (incident_id, actor_user_id, actor_role, event, old_status, new_status, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [incidentId, actor.actor_user_id, actor.actor_role, event, oldStatus, newStatus, note || null]);
}

/** Move the headline status forward (never backward), and write the audit-trail row. Pass newStatus=null to log only. */
async function setStatus(db, incidentId, newStatus, { actor, event, note }) {
  const { rows } = await db.query('SELECT status FROM incidents WHERE id = $1 FOR UPDATE', [incidentId]);
  const old = rows[0].status;
  const next = newStatus && rank(STATUS_ORDER, newStatus) > rank(STATUS_ORDER, old) ? newStatus : old;
  await db.query('UPDATE incidents SET status = $2, updated_at = now() WHERE id = $1', [incidentId, next]);
  await logEvent(db, incidentId, { actor, event, oldStatus: old, newStatus: next, note });
  return next;
}

async function lockIncident(db, id, { allowClosed = false } = {}) {
  const { rows } = await db.query('SELECT id, status FROM incidents WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw notFound('Incident not found');
  if (rows[0].status === 'closed' && !allowClosed) throw conflict('This incident is closed', 'INCIDENT_CLOSED');
  return rows[0];
}

async function getAssignment(db, incidentId) {
  const { rows } = await db.query('SELECT * FROM assignments WHERE incident_id = $1 FOR UPDATE', [incidentId]);
  return rows[0] || null;
}

/**
 * Run a state change: lock the incident, apply `handler` in one transaction, then — only after the
 * commit — fan the result out over WebSockets and push. Notifications therefore never describe a
 * change that was rolled back.
 * handler(db) returns { event, extra?, after?(row) }.
 */
async function mutate(id, handler, { allowClosed = false } = {}) {
  const outcome = await withTransaction(async (db) => {
    await lockIncident(db, id, { allowClosed });
    return handler(db);
  });
  const row = await getIncidentRow(pool, id);
  notify.fanout(row, outcome.event);
  if (outcome.after) await outcome.after(row);
  return { row, ...(outcome.extra || {}) };
}

const pushText = (row) => `${row.severity.toUpperCase()} — ${row.victim_count} victim(s) — ${row.reference_number}`;

// ---------------------------------------------------------------------------
// Creation (citizen app, USSD, or a dispatcher entering a phoned-in report)
// ---------------------------------------------------------------------------
async function createIncident(input, user = null) {
  const { lat, lng } = input;
  const point = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography';

  const created = await withTransaction(async (db) => {
    // Several bystanders usually report the same crash. Merge rather than dispatching twice.
    const dup = await db.query(
      `SELECT id, severity, victim_count, description FROM incidents
       WHERE status NOT IN ('admitted', 'closed')
         AND created_at > now() - make_interval(mins => $3::int)
         AND ST_DWithin(location, ${point}, $4)
       ORDER BY ST_Distance(location, ${point})
       LIMIT 1 FOR UPDATE`,
      [lng, lat, Math.round(config.duplicateWindowMin), config.duplicateRadiusM]);

    if (dup.rows[0]) {
      const d = dup.rows[0];
      const severity = rank(SEVERITY_ORDER, input.severity) > rank(SEVERITY_ORDER, d.severity) ? input.severity : d.severity;
      const extra = input.description && !d.description.includes(input.description) ? input.description : null;
      const description = extra ? `${d.description} | ${extra}`.replace(/^ \| /, '').slice(0, 500) : d.description;
      await db.query(
        `UPDATE incidents SET report_count = report_count + 1, severity = $2,
                victim_count = GREATEST(victim_count, $3), description = $4, updated_at = now()
         WHERE id = $1`, [d.id, severity, input.victim_count, description]);
      await setStatus(db, d.id, null, {
        actor: actorOf(user, input.source === 'ussd' ? 'ussd' : 'citizen'),
        event: 'duplicate_report_merged',
        note: `Additional ${input.source} report merged (within ${config.duplicateRadiusM} m)`,
      });
      return { id: d.id, merged: true };
    }

    const ins = await db.query(
      `INSERT INTO incidents (location, location_accuracy, location_label, severity, victim_count,
                              description, source, reporter_phone, created_by)
       VALUES (${point}, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [lng, lat, input.location_accuracy, input.location_label || null, input.severity, input.victim_count,
        input.description || '', input.source, input.reporter_phone || null, user ? user.id : null]);
    const id = ins.rows[0].id;
    const actor = actorOf(user, input.source === 'ussd' ? 'ussd' : 'citizen');
    await logEvent(db, id, { actor, event: 'incident_created', oldStatus: null, newStatus: 'reported', note: `Source: ${input.source}` });

    // Alert the nearest police unit immediately, in parallel with dispatch seeing the incident.
    const unit = await nearestPoliceUnit(db, id);
    if (unit) {
      await db.query(
        `INSERT INTO assignments (incident_id, police_unit_id, police_state, police_assigned_at)
         VALUES ($1, $2, 'notified', now())`, [id, unit.id]);
      await setStatus(db, id, 'policeNotified', {
        actor: { actor_user_id: null, actor_role: 'system' },
        event: 'police_notified',
        note: `${unit.name}${unit.is_available ? '' : ' (no unit was marked available; nearest busy unit alerted)'}`,
      });
    }
    return { id, merged: false, policeUnitId: unit ? unit.id : null };
  });

  const row = await getIncidentRow(pool, created.id);
  if (created.merged) {
    notify.fanout(row, 'duplicate_report_merged');
  } else {
    notify.fanout(row, 'incident_created', 'incident:new');
    notify.pushToResource('police', created.policeUnitId, {
      title: 'Road accident reported near you',
      body: pushText(row),
      data: { type: 'incident_new', incident_id: row.id },
    });
  }
  return { row, merged: created.merged };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
function canSee(user, row) {
  if (!user) return false;
  switch (user.role) {
    case 'dispatcher': case 'admin': return true;
    case 'police': return row.police_unit_id === user.police_unit_id;
    case 'ambulance': return row.ambulance_id === user.ambulance_id;
    case 'hospital': return row.hospital_id === user.hospital_id;
    default: return false;
  }
}

async function getIncidentForUser(id, user) {
  const row = await getIncidentRow(pool, id);
  if (!row) throw notFound('Incident not found');
  if (!user) return publicView(row); // a citizen holding the (unguessable) id sees only the public view
  if (!canSee(user, row)) throw forbidden('This incident is not assigned to you');
  return staffView(row, user.role);
}

async function listIncidents(user, { status = 'open', limit = 50, offset = 0 }) {
  const where = [];
  const params = [];
  if (status === 'open') where.push("i.status <> 'closed'");
  else if (status !== 'all') { params.push(status); where.push(`i.status = $${params.length}`); }

  const scope = { police: ['a.police_unit_id', user.police_unit_id], ambulance: ['a.ambulance_id', user.ambulance_id], hospital: ['a.hospital_id', user.hospital_id] }[user.role];
  if (scope) { params.push(scope[1]); where.push(`${scope[0]} = $${params.length}`); }

  params.push(limit, offset);
  const { rows } = await query(
    `${INCIDENT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY i.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return rows.map((r) => staffView(r, user.role));
}

async function getTimeline(id, user) {
  const row = await getIncidentRow(pool, id);
  if (!row) throw notFound('Incident not found');
  if (!canSee(user, row)) throw forbidden('This incident is not assigned to you');
  const { rows } = await query(
    `SELECT su.id, su.event, su.actor_role, u.name AS actor_name, su.old_status, su.new_status, su.note, su.created_at
     FROM status_updates su LEFT JOIN users u ON u.id = su.actor_user_id
     WHERE su.incident_id = $1 ORDER BY su.created_at, su.id`, [id]);
  return rows;
}

async function getRecommendations(id) {
  const { recommendAmbulances } = require('./dispatchService');
  const row = await getIncidentRow(pool, id);
  if (!row) throw notFound('Incident not found');
  const [ambulances, hospitals] = await Promise.all([recommendAmbulances(pool, id), recommendHospitals(pool, id)]);
  return { ambulances, hospitals };
}

// ---------------------------------------------------------------------------
// Police
// ---------------------------------------------------------------------------
function requirePoliceAssignment(as, user) {
  if (!as || as.police_unit_id !== user.police_unit_id) throw forbidden('This incident is not assigned to your unit');
}

const policeAccept = (id, user) => mutate(id, async (db) => {
  const as = await getAssignment(db, id);
  requirePoliceAssignment(as, user);
  if (as.police_state !== 'notified') throw conflict(`Already ${as.police_state}`, 'BAD_STATE');
  await db.query("UPDATE assignments SET police_state = 'accepted' WHERE incident_id = $1", [id]);
  await db.query('UPDATE police_units SET is_available = FALSE WHERE id = $1', [as.police_unit_id]);
  await setStatus(db, id, null, { actor: actorOf(user), event: 'police_accepted' });
  return { event: 'police_accepted' };
});

const policeDecline = (id, user, reason) => mutate(id, async (db) => {
  const as = await getAssignment(db, id);
  requirePoliceAssignment(as, user);
  if (!['notified', 'accepted'].includes(as.police_state)) throw conflict(`Cannot decline once ${as.police_state}`, 'BAD_STATE');
  const declined = [...as.declined_police_unit_ids, as.police_unit_id];
  const next = await nearestPoliceUnit(db, id, declined);
  await db.query(
    `UPDATE assignments SET police_unit_id = $2, police_state = $3, declined_police_unit_ids = $4, police_assigned_at = now()
     WHERE incident_id = $1`, [id, next ? next.id : null, next ? 'notified' : null, declined]);
  await setStatus(db, id, null, {
    actor: actorOf(user), event: 'police_declined',
    note: `${reason || 'No reason given'}${next ? ` — reassigned to ${next.name}` : ' — no other unit available'}`,
  });
  return {
    event: 'police_declined',
    extra: { reassigned_to: next ? next.name : null },
    after: async (row) => {
      notify.tellResource('police', as.police_unit_id, 'incident:unassigned', { incident_id: id });
      if (next) await notify.pushToResource('police', next.id, { title: 'Road accident reported near you', body: pushText(row), data: { type: 'incident_new', incident_id: id } });
    },
  };
});

const policeOnScene = (id, user) => mutate(id, async (db) => {
  const as = await getAssignment(db, id);
  requirePoliceAssignment(as, user);
  if (!['notified', 'accepted'].includes(as.police_state)) throw conflict(`Already ${as.police_state}`, 'BAD_STATE');
  await db.query("UPDATE assignments SET police_state = 'onScene' WHERE incident_id = $1", [id]);
  await db.query('UPDATE police_units SET is_available = FALSE WHERE id = $1', [as.police_unit_id]);
  await setStatus(db, id, 'policeOnScene', { actor: actorOf(user), event: 'police_on_scene' });
  return { event: 'police_on_scene' };
});

const sceneUpdate = (id, user, { verified_victim_count, hazard_notes, severity }) => mutate(id, async (db) => {
  const as = await getAssignment(db, id);
  requirePoliceAssignment(as, user);
  if (!as.police_state || as.police_state === 'notified') throw conflict('Accept the incident before updating the scene', 'BAD_STATE');
  await db.query(
    `UPDATE incidents SET verified_victim_count = COALESCE($2, verified_victim_count),
            hazard_notes = COALESCE($3, hazard_notes), severity = COALESCE($4, severity),
            victim_count = COALESCE($2, victim_count)
     WHERE id = $1`, [id, verified_victim_count ?? null, hazard_notes ?? null, severity ?? null]);
  const bits = [];
  if (verified_victim_count != null) bits.push(`victims=${verified_victim_count}`);
  if (severity) bits.push(`severity=${severity}`);
  if (hazard_notes) bits.push('hazard notes updated');
  await setStatus(db, id, null, { actor: actorOf(user), event: 'scene_updated', note: bits.join(', ') });
  return { event: 'scene_updated' };
});

const policeClear = (id, user) => mutate(id, async (db) => {
  const as = await getAssignment(db, id);
  requirePoliceAssignment(as, user);
  if (as.police_state !== 'onScene') throw conflict('Mark yourself on scene before clearing it', 'BAD_STATE');
  await db.query("UPDATE assignments SET police_state = 'cleared' WHERE incident_id = $1", [id]);
  await db.query('UPDATE police_units SET is_available = TRUE WHERE id = $1', [as.police_unit_id]);
  await setStatus(db, id, null, { actor: actorOf(user), event: 'scene_cleared' });
  return { event: 'scene_cleared' };
});

const recordCaseReference = (id, user, referenceNumber) => mutate(id, async (db) => {
  const as = await getAssignment(db, id);
  requirePoliceAssignment(as, user);
  await db.query(
    `INSERT INTO case_references (incident_id, reference_number, recorded_by) VALUES ($1, $2, $3)
     ON CONFLICT (incident_id) DO UPDATE SET reference_number = EXCLUDED.reference_number,
       recorded_by = EXCLUDED.recorded_by, recorded_at = now()`, [id, referenceNumber, user.id]);
  await setStatus(db, id, null, { actor: actorOf(user), event: 'case_reference_recorded', note: referenceNumber });
  return { event: 'case_reference_recorded' };
}, { allowClosed: true });

// ---------------------------------------------------------------------------
// Dispatcher: ambulance, hospital, close
// ---------------------------------------------------------------------------
const assignAmbulance = (id, user, ambulanceId) => mutate(id, async (db) => {
  const inc = (await db.query('SELECT status FROM incidents WHERE id = $1', [id])).rows[0];
  if (['admitted'].includes(inc.status)) throw conflict('Patient already admitted', 'BAD_STATE');
  const as = await getAssignment(db, id);
  if (as && as.ambulance_id && as.ambulance_id === ambulanceId) throw conflict('That ambulance is already assigned', 'ALREADY_ASSIGNED');

  // Claim atomically: only one dispatcher can win a given ambulance.
  let claimed;
  if (ambulanceId) {
    claimed = (await db.query(
      'UPDATE ambulances SET is_available = FALSE WHERE id = $1 AND is_available AND is_active RETURNING id, plate_number', [ambulanceId])).rows[0];
    if (!claimed) throw conflict('That ambulance is not available', 'AMBULANCE_UNAVAILABLE');
  } else {
    claimed = (await db.query(
      `UPDATE ambulances SET is_available = FALSE WHERE id = (
         SELECT a.id FROM ambulances a, incidents i
         WHERE i.id = $1 AND a.is_active AND a.is_available AND a.location IS NOT NULL
         ORDER BY a.location <-> i.location LIMIT 1 FOR UPDATE OF a SKIP LOCKED)
       RETURNING id, plate_number`, [id])).rows[0];
    if (!claimed) throw conflict('No ambulance is currently available', 'NO_AMBULANCE_AVAILABLE');
  }

  const dist = (await db.query(
    'SELECT ST_Distance(a.location, i.location) AS m FROM ambulances a, incidents i WHERE a.id = $1 AND i.id = $2',
    [claimed.id, id])).rows[0];
  const eta = estimateMinutes(dist ? dist.m : null);

  if (as && as.ambulance_id) await db.query('UPDATE ambulances SET is_available = TRUE WHERE id = $1', [as.ambulance_id]);
  await db.query(
    `INSERT INTO assignments (incident_id, ambulance_id, ambulance_state, ambulance_eta_minutes, ambulance_assigned_at)
     VALUES ($1, $2, 'assigned', $3, now())
     ON CONFLICT (incident_id) DO UPDATE SET ambulance_id = EXCLUDED.ambulance_id, ambulance_state = 'assigned',
       ambulance_eta_minutes = EXCLUDED.ambulance_eta_minutes, ambulance_assigned_at = now()`, [id, claimed.id, eta]);
  await setStatus(db, id, 'ambulanceAssigned', {
    actor: actorOf(user), event: as && as.ambulance_id ? 'ambulance_reassigned' : 'ambulance_assigned', note: claimed.plate_number,
  });
  return {
    event: 'ambulance_assigned',
    extra: { eta_minutes: eta },
    after: async (row) => {
      if (as && as.ambulance_id) notify.tellResource('ambulance', as.ambulance_id, 'incident:unassigned', { incident_id: id });
      await notify.pushToResource('ambulance', claimed.id, { title: 'New emergency job', body: pushText(row), data: { type: 'job_assigned', incident_id: id } });
    },
  };
});

const assignHospital = (id, user, hospitalId) => mutate(id, async (db) => {
  const as = await getAssignment(db, id);
  if (as && as.hospital_state === 'admitted') throw conflict('Patient already admitted', 'BAD_STATE');

  let chosen = hospitalId;
  if (!chosen) {
    const [best] = await recommendHospitals(db, id, 1);
    if (!best) throw conflict('No active hospital is configured', 'NO_HOSPITAL');
    chosen = best.id;
  }
  const h = (await db.query(
    `SELECT h.id, h.name, h.trauma_bays_free, ST_Distance(h.location, i.location) AS m
     FROM hospitals h, incidents i WHERE h.id = $1 AND h.is_active AND i.id = $2`, [chosen, id])).rows[0];
  if (!h) throw notFound('Hospital not found or inactive');

  // Time to reach the scene (if an ambulance is already on its way) plus scene -> hospital.
  const eta = (as && as.ambulance_eta_minutes ? as.ambulance_eta_minutes : 0) + estimateMinutes(h.m);
  const changed = as && as.hospital_id && as.hospital_id !== h.id;

  await db.query(
    `INSERT INTO assignments (incident_id, hospital_id, hospital_state, hospital_eta_minutes, hospital_assigned_at)
     VALUES ($1, $2, 'notified', $3, now())
     ON CONFLICT (incident_id) DO UPDATE SET hospital_id = EXCLUDED.hospital_id, hospital_state = 'notified',
       hospital_eta_minutes = EXCLUDED.hospital_eta_minutes, hospital_assigned_at = now()`, [id, h.id, eta]);
  await setStatus(db, id, 'hospitalNotified', {
    actor: actorOf(user), event: changed ? 'hospital_reassigned' : 'hospital_notified', note: h.name,
  });
  return {
    event: 'hospital_notified',
    extra: { eta_minutes: eta, warnings: h.trauma_bays_free === 0 ? ['This hospital reports no free trauma bays'] : [] },
    after: async (row) => {
      if (changed) notify.tellResource('hospital', as.hospital_id, 'incident:unassigned', { incident_id: id });
      await notify.pushToResource('hospital', h.id, {
        title: 'Incoming trauma patient(s)', body: `${pushText(row)} — ETA ~${eta} min`, data: { type: 'hospital_notice', incident_id: id },
      });
    },
  };
});

const AMBULANCE_EVENTS = {
  enRoute: ['ambulanceEnRoute', 'ambulance_en_route'],
  onScene: ['ambulanceOnScene', 'ambulance_on_scene'],
  transporting: ['transporting', 'ambulance_transporting'],
  arrived: [null, 'ambulance_arrived_at_hospital'], // the headline status moves on when the hospital admits
};

const ambulanceStatus = (id, user, state) => mutate(id, async (db) => {
  const as = await getAssignment(db, id);
  if (!as || as.ambulance_id !== user.ambulance_id) throw forbidden('This incident is not assigned to your ambulance');
  if (rank(AMBULANCE_STATES, state) <= rank(AMBULANCE_STATES, as.ambulance_state)) {
    throw conflict(`Status is already ${as.ambulance_state}`, 'BAD_STATE');
  }
  await db.query('UPDATE assignments SET ambulance_state = $2 WHERE incident_id = $1', [id, state]);
  const [status, event] = AMBULANCE_EVENTS[state];
  await setStatus(db, id, status, { actor: actorOf(user), event });
  return { event };
});

const hospitalAcknowledge = (id, user) => mutate(id, async (db) => {
  const as = await getAssignment(db, id);
  if (!as || as.hospital_id !== user.hospital_id) throw forbidden('This incident is not assigned to your hospital');
  if (as.hospital_state !== 'notified') throw conflict(`Already ${as.hospital_state}`, 'BAD_STATE');
  await db.query("UPDATE assignments SET hospital_state = 'acknowledged' WHERE incident_id = $1", [id]);
  await setStatus(db, id, null, { actor: actorOf(user), event: 'hospital_acknowledged' });
  return { event: 'hospital_acknowledged' };
});

const hospitalAdmit = (id, user) => mutate(id, async (db) => {
  const as = await getAssignment(db, id);
  if (!as || as.hospital_id !== user.hospital_id) throw forbidden('This incident is not assigned to your hospital');
  if (as.hospital_state === 'admitted') throw conflict('Already admitted', 'BAD_STATE');
  await db.query("UPDATE assignments SET hospital_state = 'admitted' WHERE incident_id = $1", [id]);
  await setStatus(db, id, 'admitted', { actor: actorOf(user), event: 'patient_admitted' });
  return { event: 'patient_admitted' };
});

const closeIncident = (id, user, { outcome = 'completed', note }) => mutate(id, async (db) => {
  const inc = (await db.query('SELECT status FROM incidents WHERE id = $1', [id])).rows[0];
  if (outcome === 'completed' && inc.status !== 'admitted') {
    throw conflict('The hospital has not confirmed admission. Close as false_alarm or cancelled instead.', 'NOT_ADMITTED');
  }
  const as = await getAssignment(db, id);
  if (as && as.ambulance_id) await db.query('UPDATE ambulances SET is_available = TRUE WHERE id = $1', [as.ambulance_id]);
  if (as && as.police_unit_id && ['accepted', 'onScene'].includes(as.police_state)) {
    await db.query("UPDATE assignments SET police_state = 'cleared' WHERE incident_id = $1", [id]);
    await db.query('UPDATE police_units SET is_available = TRUE WHERE id = $1', [as.police_unit_id]);
  }
  await setStatus(db, id, 'closed', { actor: actorOf(user), event: `incident_closed_${outcome}`, note });
  await db.query('UPDATE incidents SET closed_at = now() WHERE id = $1', [id]);
  return {
    event: 'incident_closed',
    after: async (row) => {
      if (outcome !== 'completed' && as && as.ambulance_id) {
        await notify.pushToResource('ambulance', as.ambulance_id, { title: 'Job cancelled', body: `${row.reference_number} was closed (${outcome})`, data: { type: 'job_cancelled', incident_id: id } });
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Photo attachment
// ---------------------------------------------------------------------------
async function attachPhoto(id, filePath) {
  const { rows } = await query('SELECT photo_path, status FROM incidents WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Incident not found');
  if (rows[0].status === 'closed') throw conflict('This incident is closed', 'INCIDENT_CLOSED');
  if (rows[0].photo_path) throw conflict('A photo is already attached', 'PHOTO_EXISTS');
  await query('UPDATE incidents SET photo_path = $2, updated_at = now() WHERE id = $1', [id, filePath]);
  const row = await getIncidentRow(pool, id);
  notify.fanout(row, 'photo_attached');
  return row;
}

async function getPhotoPath(id, user) {
  const row = await getIncidentRow(pool, id);
  if (!row) throw notFound('Incident not found');
  if (!canSee(user, row)) throw forbidden('This incident is not assigned to you');
  const { rows } = await query('SELECT photo_path FROM incidents WHERE id = $1', [id]);
  if (!rows[0].photo_path) throw notFound('No photo attached');
  return rows[0].photo_path;
}

module.exports = {
  STATUS_ORDER, SEVERITY_ORDER, INCIDENT_SELECT,
  createIncident, getIncidentForUser, listIncidents, getTimeline, getRecommendations, getIncidentRow,
  policeAccept, policeDecline, policeOnScene, sceneUpdate, policeClear, recordCaseReference,
  assignAmbulance, assignHospital, ambulanceStatus, hospitalAcknowledge, hospitalAdmit, closeIncident,
  attachPhoto, getPhotoPath, badRequest,
};
