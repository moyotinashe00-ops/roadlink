const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const config = require('../config');
const svc = require('../services/incidentService');
const { insideZimbabwe } = require('../services/geo');
const { publicView, staffView } = require('../services/views');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { AppError, badRequest, forbidden } = require('../middleware/errors');

const router = express.Router();
const id = validate(z.object({ id: z.uuid() }), 'params');

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const phone = z.string().trim().regex(/^\+?[0-9 ]{7,16}$/, 'Enter a valid phone number');

const createSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  severity: z.enum(svc.SEVERITY_ORDER),
  victim_count: z.coerce.number().int().min(0).max(500).default(1),
  description: z.string().trim().max(500).default(''),
  // Only honoured when a dispatcher enters a phoned-in report:
  reporter_phone: phone.optional(),
  location_accuracy: z.enum(['gps', 'approximate']).optional(),
  location_label: z.string().trim().max(120).optional(),
});

const listSchema = z.object({
  status: z.enum(['open', 'all', ...svc.STATUS_ORDER]).default('open'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Anonymous reporting must stay open (SRS CIT-01) so it is rate limited per IP instead of authenticated.
const reportLimiter = rateLimit({
  windowMs: 60 * 1000, limit: config.reportRateLimitPerMin, standardHeaders: 'draft-7', legacyHeaders: false,
  skip: (req) => config.env === 'test' || !!req.user,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many reports from this connection. Please call the dispatch centre.' } },
});

// ---------------------------------------------------------------------------
// Create + read
// ---------------------------------------------------------------------------
router.post('/', optionalAuth, reportLimiter, validate(createSchema), async (req, res) => {
  const body = req.valid.body;
  const user = req.user || null;
  if (user && !['dispatcher', 'admin'].includes(user.role)) throw forbidden('Only dispatchers can enter a report on a caller\'s behalf');

  if (config.geofenceZw && !insideZimbabwe(body.lat, body.lng)) {
    throw new AppError(422, 'Location is outside the RoadLink service area', 'OUTSIDE_SERVICE_AREA');
  }

  const { row, merged } = await svc.createIncident(
    {
      ...body,
      source: user ? 'voice' : 'app',
      location_accuracy: user ? body.location_accuracy || 'approximate' : 'gps',
      reporter_phone: user ? body.reporter_phone : undefined,
      location_label: user ? body.location_label : undefined,
    },
    user);

  res.status(merged ? 200 : 201).json(user ? { ...staffView(row, user.role), merged } : { ...publicView(row), merged });
});

router.get('/', authenticate, validate(listSchema, 'query'), async (req, res) => {
  res.json({ incidents: await svc.listIncidents(req.user, req.valid.query) });
});

router.get('/:id', id, optionalAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await svc.getIncidentForUser(req.params.id, req.user || null));
});

router.get('/:id/timeline', id, authenticate, async (req, res) => {
  res.json({ timeline: await svc.getTimeline(req.params.id, req.user) });
});

router.get('/:id/recommendations', id, authenticate, requireRole('dispatcher', 'admin'), async (req, res) => {
  res.json(await svc.getRecommendations(req.params.id));
});

// ---------------------------------------------------------------------------
// Photo (CIT-05): separate request so the report itself is never delayed by an image upload
// ---------------------------------------------------------------------------
const uploadDir = path.resolve(config.uploadDir);
fs.mkdirSync(uploadDir, { recursive: true });

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${EXT[file.mimetype] || ''}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(badRequest('Photo must be a JPEG, PNG or WebP image', 'BAD_IMAGE_TYPE'))),
});

/** The declared mimetype is client-controlled; check the file's real signature too. */
function looksLikeImage(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const webp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  return jpeg || png || webp;
}

const photoLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 6, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => config.env === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many uploads. Try again shortly.' } },
});

router.post('/:id/photo', id, photoLimiter, upload.single('photo'), async (req, res) => {
  if (!req.file) throw badRequest('Attach the image in a "photo" field', 'NO_FILE');
  const remove = () => fs.unlink(req.file.path, () => {});
  if (!looksLikeImage(req.file.path)) { remove(); throw badRequest('File is not a valid image', 'BAD_IMAGE'); }
  try {
    const { row } = await svc.attachPhoto(req.params.id, req.file.filename);
    res.status(201).json(publicView(row));
  } catch (err) { remove(); throw err; }
});

router.get('/:id/photo', id, authenticate, async (req, res) => {
  const file = await svc.getPhotoPath(req.params.id, req.user);
  res.set('Cache-Control', 'private, max-age=300');
  res.sendFile(path.join(uploadDir, path.basename(file)));
});

// ---------------------------------------------------------------------------
// Police (POL-*)
// ---------------------------------------------------------------------------
const police = requireRole('police');
const rowOut = (req, res, result) => res.json(staffView(result.row, req.user.role));

router.post('/:id/police/accept', id, authenticate, police, async (req, res) => rowOut(req, res, await svc.policeAccept(req.params.id, req.user)));

router.post('/:id/police/decline', id, authenticate, police,
  validate(z.object({ reason: z.string().trim().max(200).optional() })),
  async (req, res) => {
    const r = await svc.policeDecline(req.params.id, req.user, req.valid.body.reason);
    res.json({ reassigned_to: r.reassigned_to });
  });

router.post('/:id/police/on-scene', id, authenticate, police, async (req, res) => rowOut(req, res, await svc.policeOnScene(req.params.id, req.user)));
router.post('/:id/police/clear', id, authenticate, police, async (req, res) => rowOut(req, res, await svc.policeClear(req.params.id, req.user)));

router.patch('/:id/scene', id, authenticate, police,
  validate(z.object({
    verified_victim_count: z.number().int().min(0).max(500).optional(),
    hazard_notes: z.string().trim().max(500).optional(),
    severity: z.enum(svc.SEVERITY_ORDER).optional(),
  }).refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update')),
  async (req, res) => rowOut(req, res, await svc.sceneUpdate(req.params.id, req.user, req.valid.body)));

router.put('/:id/case-reference', id, authenticate, police,
  validate(z.object({ reference_number: z.string().trim().min(3).max(60) })),
  async (req, res) => rowOut(req, res, await svc.recordCaseReference(req.params.id, req.user, req.valid.body.reference_number)));

// ---------------------------------------------------------------------------
// Dispatcher (DIS-*)
// ---------------------------------------------------------------------------
const dispatcher = requireRole('dispatcher', 'admin');

router.post('/:id/police', id, authenticate, dispatcher,
  validate(z.object({ police_unit_id: z.uuid().optional() })),
  async (req, res) => rowOut(req, res, await svc.assignPolice(req.params.id, req.user, req.valid.body.police_unit_id)));

router.post('/:id/ambulance', id, authenticate, dispatcher,
  validate(z.object({ ambulance_id: z.uuid().optional(), force: z.boolean().optional() })),
  async (req, res) => {
    const r = await svc.assignAmbulance(req.params.id, req.user, req.valid.body.ambulance_id, { force: req.valid.body.force });
    res.json({ ...staffView(r.row, req.user.role), eta_minutes: r.eta_minutes });
  });

router.post('/:id/hospital', id, authenticate, dispatcher,
  validate(z.object({ hospital_id: z.uuid().optional() })),
  async (req, res) => {
    const r = await svc.assignHospital(req.params.id, req.user, req.valid.body.hospital_id);
    res.json({ ...staffView(r.row, req.user.role), eta_minutes: r.eta_minutes, warnings: r.warnings });
  });

router.post('/:id/close', id, authenticate, dispatcher,
  validate(z.object({ outcome: z.enum(['completed', 'no_transport', 'false_alarm', 'cancelled']).default('completed'), note: z.string().trim().max(300).optional() })),
  async (req, res) => rowOut(req, res, await svc.closeIncident(req.params.id, req.user, req.valid.body)));

// ---------------------------------------------------------------------------
// Ambulance crew (AMB-*)
// ---------------------------------------------------------------------------
router.post('/:id/ambulance/status', id, authenticate, requireRole('ambulance'),
  validate(z.object({ status: z.enum(['enRoute', 'onScene', 'transporting', 'arrived']) })),
  async (req, res) => rowOut(req, res, await svc.ambulanceStatus(req.params.id, req.user, req.valid.body.status)));

// Patient vitals (UC9). Partial readings are fine, but at least one value is required, and blood
// pressure is a pair. Consciousness is the AVPU scale: alert, responds to voice, to pain, unresponsive.
const vitalsSchema = z.object({
  pulse_bpm: z.number().int().min(0).max(300).optional(),
  systolic_bp: z.number().int().min(0).max(300).optional(),
  diastolic_bp: z.number().int().min(0).max(200).optional(),
  spo2_percent: z.number().int().min(0).max(100).optional(),
  consciousness: z.enum(['alert', 'voice', 'pain', 'unresponsive']).optional(),
}).strict().refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Enter at least one vital' })
  .refine((v) => (v.systolic_bp === undefined) === (v.diastolic_bp === undefined), { message: 'Blood pressure needs both the systolic and the diastolic value' })
  .refine((v) => v.systolic_bp === undefined || v.diastolic_bp <= v.systolic_bp, { message: 'Diastolic pressure cannot be higher than systolic' });

router.post('/:id/ambulance/vitals', id, authenticate, requireRole('ambulance'), validate(vitalsSchema),
  async (req, res) => rowOut(req, res, await svc.recordVitals(req.params.id, req.user, req.valid.body)));

router.get('/:id/vitals', id, authenticate, requireRole('dispatcher', 'admin', 'ambulance', 'hospital'),
  async (req, res) => res.json({ vitals: await svc.getVitals(req.params.id, req.user) }));

// ---------------------------------------------------------------------------
// Hospital (HOS-*)
// ---------------------------------------------------------------------------
const hospital = requireRole('hospital');
router.post('/:id/hospital/acknowledge', id, authenticate, hospital, async (req, res) => rowOut(req, res, await svc.hospitalAcknowledge(req.params.id, req.user)));
router.post('/:id/hospital/admit', id, authenticate, hospital, async (req, res) => rowOut(req, res, await svc.hospitalAdmit(req.params.id, req.user)));

module.exports = router;
