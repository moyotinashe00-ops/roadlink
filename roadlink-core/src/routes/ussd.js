// USSD gateway callback (SRS CIT-08) for feature phones with no data plan.
//
// Written against the Africa's Talking USSD callback format: a form-encoded POST with
// sessionId, serviceCode, phoneNumber and `text` — the user's answers so far joined by '*'
// (e.g. "3*2*3"). We reply in plain text starting with "CON " (keep the session open) or
// "END " (final message). Other aggregators use similar shapes; adapt the parsing in parseBody().
//
// USSD carries no GPS, so the reporter picks an area from a list. The incident is stored with
// location_accuracy = 'approximate' so the dispatcher knows to phone the reporter back
// (their number is saved) and confirm the exact spot before sending a crew.
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { query } = require('../db');
const { createIncident } = require('../services/incidentService');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => config.env === 'test',
});

const VICTIMS = [1, 3, 4];                                   // menu answers 1/2/3 -> "1", "2-3", "4 or more"
const SEVERITIES = ['minor', 'serious', 'critical', 'fatal']; // menu answers 1..4

function secretOk(provided) {
  if (!config.ussdSecret || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(config.ussdSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const reply = (res, text) => res.type('text/plain').send(text);

router.post('/', limiter, express.urlencoded({ extended: false }), async (req, res) => {
  if (!secretOk(req.query.key)) return res.status(403).type('text/plain').send('END Service unavailable.');

  const phoneNumber = String(req.body.phoneNumber || '').slice(0, 20);
  const steps = String(req.body.text || '').split('*').filter((s) => s !== '');

  const { rows: areas } = await query(
    `SELECT name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
     FROM known_areas ORDER BY sort_order LIMIT 9`);

  if (steps.length === 0) {
    const menu = areas.map((a, i) => `${i + 1}. ${a.name}`).join('\n');
    return reply(res, `CON RoadLink: report a road accident.\nWhere is it?\n${menu}\n0. Other place`);
  }

  if (steps[0] === '0') return reply(res, 'END Please call the emergency line and describe the location to the operator.');
  const area = areas[Number(steps[0]) - 1];
  if (!area) return reply(res, 'END Invalid choice. Please dial again, or call the emergency line.');

  if (steps.length === 1) return reply(res, 'CON How many people are hurt?\n1. One person\n2. Two or three\n3. Four or more');
  const victims = VICTIMS[Number(steps[1]) - 1];
  if (!victims) return reply(res, 'END Invalid choice. Please dial again, or call the emergency line.');

  if (steps.length === 2) return reply(res, 'CON How serious?\n1. Minor\n2. Serious\n3. Critical\n4. Someone has died');
  const severity = SEVERITIES[Number(steps[2]) - 1];
  if (!severity) return reply(res, 'END Invalid choice. Please dial again, or call the emergency line.');

  const { row, merged } = await createIncident({
    lat: area.lat, lng: area.lng, severity, victim_count: victims,
    description: `USSD report near ${area.name}`,
    source: 'ussd', location_accuracy: 'approximate', location_label: area.name,
    reporter_phone: phoneNumber || undefined,
  });

  return reply(res, `END Report received. Reference ${row.reference_number}${merged ? ' (already reported by others)' : ''}. Help is being alerted. Keep your phone on: we may call to confirm the exact place.`);
});

module.exports = router;
