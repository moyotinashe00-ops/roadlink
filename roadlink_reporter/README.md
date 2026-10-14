# RoadLink Reporter

The citizen-facing mobile application from the RoadLink ZW SRS (§2.3, "RoadLink
Reporter"). Built in Flutter per the tech stack in SRS §10.1. This app fulfils
functional requirements **CIT-01 through CIT-10**.

## What's implemented

| Screen | Requirement(s) | Behaviour |
|---|---|---|
| `HomeScreen` | CIT-01 | One primary action — no account, no sign-up. |
| `ReportScreen` | CIT-02–CIT-06, CIT-08 | Auto GPS capture, victim count, severity, description, optional photo, submit. On network failure, offers an immediate call to dispatch instead of silently queueing (see "Design note" below). |
| `StatusScreen` | CIT-09 | Live timeline of the incident's status, matching the lifecycle in SRS §5.3. |
| Dispatch call button | CIT-10 | One tap to `tel:` the dispatch centre from anywhere in the app. |

`RoadLink Police` and `RoadLink Ambulance` (SRS §2.3) are meant to share this
same `theme/`, `models/`, and `services/` layer — the map-and-single-status-card
UI described for them in SRS §6.1 slots in as new screens against the existing
`ApiService`/`Incident` model rather than a new codebase.

## Design note: why the app calls out on failure instead of queueing

The SRS deliberately drops "offline-first" (see the SRS's Appendix B). If
`ApiService.submitIncident` can't reach the backend, this app does **not**
store the report and wait — it immediately offers the one-tap "CALL DISPATCH"
fallback, because a report that is silently queued but never seen by a
dispatcher is more dangerous than asking the reporter to use the channel that
is actually working right now.

## Running it

This repository ships `pubspec.yaml` and `lib/` only. To run it:

```bash
flutter create --org zw.co.roadlink roadlink_reporter_shell
# copy pubspec.yaml and lib/ from this repo into that shell, overwriting both
cd roadlink_reporter_shell
flutter pub get
flutter run
```

### Connect to RoadLink Core

Reporter does not generate demo incidents or simulate status changes.
It submits and follows reports through RoadLink Core, the shared backend used
by the RoadLink apps.

Set `ROADLINK_API` to the Core host root (without `/api/v1`):

```bash
# Android emulator talking to Core on the development host
flutter run --dart-define=ROADLINK_API=http://10.0.2.2:3000

# Physical device: use the development host's LAN address
flutter run --dart-define=ROADLINK_API=http://192.168.1.20:3000

# Deployed environment
flutter run --dart-define=ROADLINK_API=https://core.example.com
```

Reporter creates incidents with `POST /api/v1/incidents`, optionally attaches
a photo with `POST /api/v1/incidents/{id}/photo`, and polls
`GET /api/v1/incidents/{id}` every five seconds for shared status changes.
Use the same Core environment for Reporter, Police, Ambulance, Dispatch, and
Hospital so every app sees the same incident records and lifecycle.

## Required native permissions

These permissions are configured in the platform files. Android requires
network access for Core and location access for incident reports. iOS also
declares location, camera, and photo-library purpose strings.

**`android/app/src/main/AndroidManifest.xml`** (inside `<manifest>`, above `<application>`):

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.CAMERA" />
```

**`ios/Runner/Info.plist`** (inside the top-level `<dict>`):

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>RoadLink Reporter needs your location to pinpoint the accident.</string>
<key>NSCameraUsageDescription</key>
<string>RoadLink Reporter needs the camera to attach a photo of the scene.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>RoadLink Reporter needs photo library access to attach a photo of the scene.</string>
```

## Next apps to build from this same stack

Per SRS §10.5's suggested division of work:

- **RoadLink Police / RoadLink Ambulance** — same Flutter/Dart stack, reusing
  `theme/app_theme.dart`, `models/incident.dart`, and a role-scoped
  `ApiService`. Primary UI is a map + one active-job card + one status button.
- **RoadLink Dispatch / RoadLink Hospital / RoadLink Admin** — React (Vite),
  consuming the same REST/WebSocket contract from the web.
