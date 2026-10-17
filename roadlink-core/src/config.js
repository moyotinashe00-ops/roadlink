require('dotenv').config();

const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/roadlink',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  seedPassword: process.env.SEED_PASSWORD || 'ChangeMe123!',
  geofenceZw: bool(process.env.GEOFENCE_ZW, false),
  duplicateRadiusM: num(process.env.DUPLICATE_RADIUS_M, 150),
  duplicateWindowMin: num(process.env.DUPLICATE_WINDOW_MIN, 30),
  // A position older than this is treated as stale: flagged in recommendations and never preferred by auto-dispatch.
  staleLocationMin: num(process.env.STALE_LOCATION_MIN, 10),
  // If the alerted police unit has not accepted or declined within this time, alert the next nearest unit.
  policeAckTimeoutMin: num(process.env.POLICE_ACK_TIMEOUT_MIN, 3),
  escalationIntervalSec: num(process.env.ESCALATION_INTERVAL_SEC, 30),
  // Per-IP limit on anonymous reports. Mobile networks often put many people behind one address, so keep this generous.
  reportRateLimitPerMin: num(process.env.REPORT_RATE_LIMIT_PER_MIN, 60),
  etaAvgSpeedKmh: num(process.env.ETA_AVG_SPEED_KMH, 35),
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  // Set to 1 when running behind a reverse proxy / PaaS (Render, Railway, Nginx) so rate limits see real client IPs.
  trustProxy: process.env.TRUST_PROXY === undefined || process.env.TRUST_PROXY === '' ? false : Number(process.env.TRUST_PROXY),
  ussdSecret: process.env.USSD_SECRET || '',
};

// Zimbabwe bounding box (approximate) used by the optional geofence.
config.zwBounds = { minLat: -22.5, maxLat: -15.5, minLng: 25.0, maxLng: 33.2 };

if (config.env === 'production' && config.jwtSecret === 'change-me-in-production') {
  throw new Error('JWT_SECRET must be set in production.');
}

if (config.env === 'production' && config.trustProxy === false) {
  console.warn('[config] TRUST_PROXY is not set. Behind a reverse proxy every client will share one IP and one rate limit; set TRUST_PROXY=1.');
}

if (config.env === 'production' && config.corsOrigins.length === 0) {
  console.warn('[config] CORS_ORIGINS is not set: browser apps on other origins (the hospital dashboard) will be blocked. Mobile apps are unaffected.');
}

if (config.env === 'production' && !config.ussdSecret) {
  console.warn('[config] USSD_SECRET is not set: the /ussd endpoint will reject all requests until it is.');
}

module.exports = config;
