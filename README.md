# RoadLink ZW

Emergency road-accident reporting and dispatch for Zimbabwe. A citizen reports a crash, the nearest police unit is
alerted immediately, a dispatcher sends an ambulance and a hospital, and every party sees the same live status.
The apps never talk to each other directly: they all go through one API.

| Folder | What it is | Stack |
|---|---|---|
| [`roadlink-core`](roadlink-core) | The backend API: incidents, dispatch, real-time updates, USSD, push | Node.js, Express 5, PostgreSQL + PostGIS, Socket.IO |
| [`roadlink_reporter`](roadlink_reporter) | Citizen app: SOS button, report, live status | Flutter |
| [`roadlink_field_apps`](roadlink_field_apps) | Police and ambulance crew apps (shared package) | Flutter |
| [`roadlink-dispatch`](roadlink-dispatch) | Control-room console: live map, incident list, send ambulance and hospital, phoned-in reports | React + Vite + Leaflet |
| [`roadlink-hospital`](roadlink-hospital) | Hospital emergency-department board | React + Vite |

## Quick start

You need Node 20+, PostgreSQL 15+ with PostGIS, and (for the mobile apps) the Flutter SDK.

```bash
# 1. Backend
cd roadlink-core
cp .env.example .env              # then edit DATABASE_URL and JWT_SECRET
npm install
npm run db:seed                   # creates the schema and demo accounts (development only)
npm start                         # http://localhost:3000

# 2. Hospital dashboard (second terminal)
cd roadlink-hospital
npm install
npm run dev                       # http://localhost:5173, sign in as hospital1@roadlink.zw

# 2b. Dispatcher console (third terminal)
cd roadlink-dispatch
npm install
npm run dev                       # http://localhost:5176, sign in as dispatcher@roadlink.zw

# 3. Mobile apps (point them at your machine)
cd roadlink_reporter
flutter pub get
flutter run --dart-define=ROADLINK_API=http://10.0.2.2:3000   # Android emulator
```

Demo accounts use the `SEED_PASSWORD` from `.env`. See each folder's README for details.

## Run the Flutter apps in a browser

Each app can run in Chrome with `flutter run -d chrome`. The backend must be running first (see Quick start). Give each
app its own port, because the Docker setup only allows browser requests from ports 5173-5177 and 5180-5182:

```powershell
# Citizen app (Reporter)
cd roadlink_reporter
flutter pub get
flutter run -d chrome --web-port 5180

# Police app
cd roadlink_field_apps\apps\roadlink_police
flutter pub get
flutter run -d chrome --web-port 5181

# Ambulance app
cd roadlink_field_apps\apps\roadlink_ambulance
flutter pub get
flutter run -d chrome --web-port 5182
```

In a browser the apps talk to `http://localhost:3000` by default. To use another server, add
`--dart-define=ROADLINK_API=http://host:3000`. Demo logins for the Police and Ambulance apps are
`police1@roadlink.zw` and `ambulance1@roadlink.zw` (password from `SEED_PASSWORD`).

Things that behave differently in a browser:
- Chrome asks for **location permission**; allow it, or the report screen keeps waiting for GPS. It only works on
  `localhost` or HTTPS.
- **Photos** open a file picker instead of the camera on a computer.
- The "call dispatch" button does nothing on a computer that has no phone app.
- Push notifications are not used in the browser. Live updates still arrive through the socket connection.

## Checks

```bash
cd roadlink-core     && npm run lint && npm test     # 62 integration tests on a real PostGIS database
cd roadlink-hospital && npm run lint && npm test && npm run build
cd roadlink-hospital && npm run contract             # needs the backend running; checks the dashboard against the live API
cd roadlink-dispatch && npm run lint && npm test && npm run build && npm run contract
cd roadlink_reporter && flutter analyze && flutter test
```

## How dispatch behaves

- Simultaneous reports of one crash are merged into a single incident, and one police unit is alerted.
- If the alerted police unit does not answer within `POLICE_ACK_TIMEOUT_MIN`, the next nearest unit is alerted;
  dispatch is warned when nobody is left.
- Auto-dispatch prefers ambulances with a recent GPS position. A position older than `STALE_LOCATION_MIN` is only
  used when nothing fresher is free.
- An ambulance that is on scene or carrying a patient cannot be reassigned by accident.

Full API reference: [`roadlink-core/docs/API.md`](roadlink-core/docs/API.md). Read the
"Known limitations" section of [`roadlink-core/README.md`](roadlink-core/README.md) before relying on this in production.

## Look and feel

"Hi-Vis on Ink": warm black background, hi-vis lime as the brand colour, and triage-tag colours that always mean the
same thing (green minor, yellow serious, vermilion critical, bone fatalities). The display face is Big Shoulders
Display; body text is IBM Plex Sans. The dashboard bundles its fonts, so it makes no external font requests.
The Flutter apps share the palette through `AppColors` and the display font through `RoadLinkFonts`.
