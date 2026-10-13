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

if (config.env === 'production' && !config.ussdSecret) {
  console.warn('[config] USSD_SECRET is not set: the /ussd endpoint will reject all requests until it is.');
}

module.exports = config;
