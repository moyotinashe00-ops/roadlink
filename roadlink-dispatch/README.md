# RoadLink Dispatch

The control-room console for RoadLink ZW. A dispatcher sees every incident and every vehicle on one live screen,
sends ambulances and hospitals, enters reports that callers phone in, and closes incidents.

```
 Incidents (left)          Live map (middle)             The selected incident (right)
 most urgent first,        incidents by severity,        who is alerted, ambulance and hospital
 with what each still      ambulances and police         choices with distance and ETA,
 needs shown in red        units moving live             timeline, close
```

## What a dispatcher can do

- **Watch the board.** New reports appear the moment they arrive, with a chime (it can be switched off) and a banner.
  Incidents are ordered critical, serious, fatalities, minor; oldest first within a level.
- **See what is missing.** Each card shows the state of police, ambulance and hospital. Red means the dispatcher still
  has to act. The header counts incidents that need action.
- **Alert police by hand.** Police are alerted automatically. When nobody was found, or the alerted unit is silent, the
  panel lists police units (available first, with distance and ETA) so the dispatcher can pick one or press *Alert
  nearest*. A unit that has already accepted cannot be taken away.
- **Send an ambulance.** Ambulances are listed closest first with an ETA. One with an old GPS position is tagged
  "old position". *Auto-assign best* lets the server choose; it prefers vehicles with a recent position.
- **Replace a crew only on purpose.** If the crew is already on scene or carrying a patient, replacing it needs a
  confirmed breakdown, and the server enforces the same rule.
- **Send a hospital.** Hospitals are listed by distance with free trauma bays. A full hospital is tagged "full";
  numbers that have not been updated recently are tagged "old numbers".
- **Enter a phoned-in report.** *New report*, click the map where the caller says it is, set severity, people hurt,
  place and the caller's number. The report is marked approximate and the nearest police unit is alerted at once.
- **Close with an outcome:** completed (only after the hospital confirms admission), no transport, false alarm or
  cancelled.
- **Read the full timeline** and see the scene photo and the caller's number.

Dispatchers and administrators can sign in. Other roles are turned away with a clear message.

### Administration (administrator accounts)

An **Admin** button opens the management screens:

- **Summary:** incidents in the last 7, 30 or 90 days and the average time from report to police on scene, ambulance
  assigned, ambulance on scene and hospital admission. A stage nobody has reached yet shows "no data yet", never 0.
- **Users:** create accounts (police, ambulance and hospital accounts must be linked to their unit, vehicle or hospital),
  disable or enable them, and reset passwords.
- **Ambulances, Police units, Hospitals:** add new ones and switch them off or on. Switched-off records stay listed here
  so a mistake can be undone, and are hidden from dispatch.

## Run it

You need the backend running with the demo data (see the root README).

```bash
npm install
npm run dev        # http://localhost:5176  (the port is fixed so the backend's CORS list can allow it)
```

Sign in as `dispatcher@roadlink.zw` with the `SEED_PASSWORD` from the backend's `.env` (default `ChangeMe123!`).
To use another backend, set `VITE_API_URL=http://host:3000`. The origin of this page (`http://localhost:5176`) must be in
the backend's `CORS_ORIGINS`; the example `.env` and the Docker setup already include it.

The map uses OpenStreetMap tiles, so the machine needs internet access to show the street map. Everything else works
without it.

## Checks

```bash
npm run lint
npm test           # 44 tests: ordering, the API client, dispatch flows and the admin screens
npm run build
npm run contract   # needs the backend running: the console's own API and live-feed code against the real server
```

`npm run contract` signs in as a dispatcher, enters a report, watches it arrive over the live connection, alerts a
police unit by hand, assigns and replaces an ambulance, assigns a hospital, tries to close early, closes, then signs in as
an administrator to manage accounts, vehicles, units and hospitals and read the summary, and checks who may and may not
do each step.

## Limits

- A hospital's location is typed in as two coordinates (copy them from Google Maps); there is no map picker for it yet.
- Deleting is not offered on purpose: records are switched off instead, so past incidents keep their history.
- The sound alert needs one click on the page before the browser allows audio.
