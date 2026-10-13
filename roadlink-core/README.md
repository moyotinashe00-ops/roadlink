# RoadLink Core

The backend for **RoadLink ZW**: the single API, real-time channel and dispatch logic that the six client
applications (Reporter, Police, Ambulance, Dispatch, Hospital, Admin) all talk to. Implements SRS §3, §4.7, §5 and §6.

**Stack:** Node.js + Express 5 · PostgreSQL + PostGIS · Socket.IO · JWT · Firebase Cloud Messaging · zod

```
Reporter app ─┐                         ┌─ PostgreSQL + PostGIS
USSD gateway ─┤                         │   (nearest-resource queries)
Police app ───┤   REST + Socket.IO      │
Ambulance app ┼──► RoadLink Core ───────┼─ Firebase Cloud Messaging (push)
Dispatch web ─┤   (this repo)           │
Hospital web ─┤                         └─ uploads/ (photos)
Admin web ────┘
```

Clients never talk to each other; every interaction goes through this service, which is what lets the six apps
be built and deployed independently.

## Quick start

**Option A: Docker**
```bash
docker compose up --build
docker compose exec api node db/migrate.js --seed   # demo hospitals, ambulances, police, accounts
curl localhost:3000/health
```

**Option B: local**
```bash
# needs PostgreSQL 14+ with the PostGIS extension available
createdb roadlink
cp .env.example .env            # then set JWT_SECRET etc.
npm install
npm run db:seed                 # applies db/schema.sql (idempotent) + demo data
npm run dev
```

Demo logins (password = `SEED_PASSWORD`, default `ChangeMe123!`): `admin@`, `dispatcher@`, `police1@`, `police2@`,
`ambulance1@`, `ambulance2@`, `hospital1@`, `hospital2@` `roadlink.zw`. **Development only**: seeding is refused when
`NODE_ENV=production`.

## Connecting the Flutter Reporter app

In `report_screen.dart` and `status_screen.dart`, change `ApiService()` to:

```dart
ApiService(baseUrl: 'http://10.0.2.2:3000/api/v1', mockMode: false)   // 10.0.2.2 = host machine from the Android emulator
```

The response field names and the status strings (`policeNotified`, `ambulanceEnRoute`, …) already match what the
app's `Incident.fromJson` / `IncidentStatus` parse. For plain-`http` development on Android add
`android:usesCleartextTraffic="true"` to the `<application>` tag; use HTTPS in any real deployment.
Photo upload (`POST /incidents/:id/photo`) is implemented server-side; the Flutter app does not call it yet.

## Tests

```bash
npm test     # 51 integration tests against a REAL PostgreSQL + PostGIS database
```
Tests run against `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/roadlink_test`) and
**truncate every table**, so the harness refuses to start unless the database name ends in `_test`. They cover the full
report → admission lifecycle, role isolation, real-time delivery, ambulance-claim races, duplicate merging, USSD, photo
upload hardening, validation and admin management.

## Project layout

```
db/schema.sql        entities from SRS §5 (idempotent)      db/seed.js      demo data (Harare)
src/app.js           Express app + routes                   src/server.js   HTTP + Socket.IO bootstrap
src/routes/          auth · incidents · resources · admin · ussd
src/services/        incidentService (workflow rules) · dispatchService (PostGIS ranking)
                     notifications (sockets + FCM) · views (public vs staff) · geo (ETA)
src/realtime/        Socket.IO auth and rooms
tests/               integration suites                      docs/API.md     endpoint + event reference
```

## Design decisions worth knowing

- **One transaction per state change, notifications after commit.** Every workflow step locks the incident row,
  writes the change and the audit-trail row together, and only then notifies. Clients never hear about a change that
  was rolled back.
- **Ambulances are claimed atomically** (`UPDATE … WHERE is_available`, plus `FOR UPDATE SKIP LOCKED` for auto-pick),
  so two dispatchers cannot send the same vehicle to two crashes. Covered by a concurrency test.
- **Status only moves forward.** Police, ambulance and hospital progress in parallel; a late lower-ranked event goes in
  the audit trail without making the citizen's view regress.
- **Duplicate reports are merged**, not double-dispatched: a new report within 150 m of an open incident in the last
  30 minutes raises `report_count`, takes the worse severity and higher victim count, and notifies dispatch.
- **Citizens need no account** (SRS CIT-01), so abuse is handled by per-IP rate limiting, strict validation, an
  optional Zimbabwe geofence (`GEOFENCE_ZW`), and duplicate merging. Their incident id is an unguessable UUID that
  unlocks only a minimal public view; reporter phone numbers go to dispatch only.
- **Channel redundancy instead of offline sync**, per the revised SRS: app → USSD → voice call all create the same
  incident record.
- **Police are a first-class actor:** the nearest available unit is alerted at creation; they can accept, decline
  (auto-reassign to the next-nearest), update scene facts and record the case number.

## Known limitations (read before relying on this)

- **ETA is an estimate**: straight-line distance × 1.4 at `ETA_AVG_SPEED_KMH`. Replace `estimateMinutes()` in
  `src/services/geo.js` with Google Directions/Mapbox for road-accurate times.
- **USSD location is approximate** (area picked from `known_areas`); dispatch must call back to confirm. Add a fuller
  area list, or operator cell-ID location, for production.
- **FCM push is untested against real Firebase.** Without `FIREBASE_SERVICE_ACCOUNT_JSON` pushes are logged
  (dry-run), which is what the tests exercise. Verify with a real device token before relying on it.
- **Docker files were not built here** (no Docker in the dev sandbox); the schema, API and tests were run against real
  PostgreSQL 16 + PostGIS 3.4.
- **One ambulance per incident.** Multi-vehicle crashes are not modelled yet.
- **Single-instance assumptions:** rate limits are in-memory, photos go to local disk, and Socket.IO rooms are
  per-process. Scaling out needs Redis (rate limit store + `@socket.io/redis-adapter`) and object storage (S3) for photos.
- **Socket auth is checked at connect.** A deactivated user's *HTTP* access stops immediately, but an already-open
  socket stays until it reconnects or its token expires (a timer disconnects it at expiry).
- **Seed coordinates are approximate** demo data; verify real hospital/station locations before any live use.
- Not load-tested.
