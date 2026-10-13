// Demo data for development and the SRS prototype evaluation (Harare).
// Coordinates are approximate — verify against real locations before any live use.
const bcrypt = require('bcryptjs');

const HOSPITALS = [
  { name: 'Parirenyatwa Group of Hospitals', lat: -17.8143, lng: 31.0446, phone: '+263242701000', total: 8, free: 5 },
  { name: 'Harare Central Hospital',         lat: -17.8419, lng: 31.0378, phone: '+263242705000', total: 6, free: 3 },
  { name: 'Avenues Clinic',                  lat: -17.8221, lng: 31.0405, phone: '+263242251515', total: 4, free: 2 },
  { name: 'Chitungwiza Central Hospital',    lat: -18.0107, lng: 31.0746, phone: '+263270222000', total: 4, free: 0 },
];

const POLICE = [
  { name: 'ZRP Harare Central Traffic', station: 'Harare Central', area: 'CBD / Eastlea', lat: -17.8290, lng: 31.0522 },
  { name: 'ZRP Highlands Traffic',      station: 'Highlands',      area: 'Highlands / Borrowdale', lat: -17.8068, lng: 31.0865 },
  { name: 'ZRP Mabelreign Traffic',     station: 'Mabelreign',     area: 'Mabelreign / Avondale', lat: -17.8105, lng: 30.9890 },
  { name: 'ZRP Highfield Traffic',      station: 'Highfield',      area: 'Highfield / Mbare', lat: -17.8780, lng: 31.0120 },
];

const AMBULANCES = [
  { plate: 'ADX-1001', provider: 'City of Harare', lat: -17.8310, lng: 31.0480 },
  { plate: 'ADX-1002', provider: 'City of Harare', lat: -17.7990, lng: 31.0700 },
  { plate: 'ADX-1003', provider: 'City of Harare', lat: -17.8650, lng: 31.0300 },
  { plate: 'ADX-1004', provider: 'Private provider', lat: -17.8100, lng: 30.9950 },
];

const AREAS = [
  ['Harare CBD', -17.8292, 31.0522], ['Avondale', -17.8004, 31.0371], ['Borrowdale', -17.7640, 31.0900],
  ['Highfield', -17.8780, 31.0120], ['Mbare', -17.8610, 31.0440], ['Mabelreign', -17.8105, 30.9890],
  ['Eastlea', -17.8300, 31.0680], ['Waterfalls', -17.9000, 31.0200], ['Chitungwiza', -18.0107, 31.0746],
];

const point = (lng, lat) => `ST_SetSRID(ST_MakePoint(${Number(lng)}, ${Number(lat)}), 4326)::geography`;

async function seed(db, password) {
  const hash = await bcrypt.hash(password, 10);

  const hospitalIds = [];
  for (const h of HOSPITALS) {
    const r = await db.query(
      `INSERT INTO hospitals (name, location, contact_number, trauma_bays_total, trauma_bays_free)
       SELECT $1, ${point(h.lng, h.lat)}, $2, $3, $4
       WHERE NOT EXISTS (SELECT 1 FROM hospitals WHERE name = $1)
       RETURNING id`, [h.name, h.phone, h.total, h.free]);
    hospitalIds.push(r.rows[0]?.id);
  }
  const policeIds = [];
  for (const p of POLICE) {
    const r = await db.query(
      `INSERT INTO police_units (name, station, coverage_area, location, location_updated_at)
       SELECT $1, $2, $3, ${point(p.lng, p.lat)}, now()
       WHERE NOT EXISTS (SELECT 1 FROM police_units WHERE name = $1)
       RETURNING id`, [p.name, p.station, p.area]);
    policeIds.push(r.rows[0]?.id);
  }
  const ambulanceIds = [];
  for (const a of AMBULANCES) {
    const r = await db.query(
      `INSERT INTO ambulances (plate_number, provider, location, location_updated_at)
       VALUES ($1, $2, ${point(a.lng, a.lat)}, now())
       ON CONFLICT (plate_number) DO NOTHING RETURNING id`, [a.plate, a.provider]);
    ambulanceIds.push(r.rows[0]?.id);
  }
  for (const [i, [name, lat, lng]] of AREAS.entries()) {
    await db.query(
      `INSERT INTO known_areas (name, location, sort_order) VALUES ($1, ${point(lng, lat)}, $2)
       ON CONFLICT (name) DO NOTHING`, [name, i]);
  }

  const user = (name, email, role, extra = {}) => db.query(
    `INSERT INTO users (name, email, password_hash, role, hospital_id, police_unit_id, ambulance_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (email) DO NOTHING`,
    [name, email, hash, role, extra.hospital || null, extra.police || null, extra.ambulance || null]);

  await user('System Admin', 'admin@roadlink.zw', 'admin');
  await user('Dispatcher One', 'dispatcher@roadlink.zw', 'dispatcher');
  if (policeIds[0]) await user('Officer Moyo', 'police1@roadlink.zw', 'police', { police: policeIds[0] });
  if (policeIds[1]) await user('Officer Dube', 'police2@roadlink.zw', 'police', { police: policeIds[1] });
  if (ambulanceIds[0]) await user('Crew ADX-1001', 'ambulance1@roadlink.zw', 'ambulance', { ambulance: ambulanceIds[0] });
  if (ambulanceIds[1]) await user('Crew ADX-1002', 'ambulance2@roadlink.zw', 'ambulance', { ambulance: ambulanceIds[1] });
  if (hospitalIds[0]) await user('Parirenyatwa ED Desk', 'hospital1@roadlink.zw', 'hospital', { hospital: hospitalIds[0] });
  if (hospitalIds[1]) await user('Harare Central ED Desk', 'hospital2@roadlink.zw', 'hospital', { hospital: hospitalIds[1] });
}

module.exports = { seed };
