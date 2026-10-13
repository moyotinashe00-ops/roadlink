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

### Demo mode (no backend required)

`ApiService()` defaults to `mockMode: true`. Submitting a report returns a
fake reference number immediately, and the status screen plays back a
realistic `Reported → … → Admitted` sequence over about 35 seconds — enough
to demo the whole app, including the multi-application coordination story,
without RoadLink Core running.

### Wiring up the real backend

Once `RoadLink Core` (SRS §4.7) is deployed:

```dart
final _apiService = ApiService(
  baseUrl: 'https://your-roadlink-core-url/v1',
  mockMode: false,
);
```

This switches `submitIncident` to `POST /incidents` and `watchIncident` to
polling `GET /incidents/{id}` every 5 seconds, matching the REST contract in
SRS §6.4 and the WebSocket-unreachable fallback in NFR §7.3.

## Required native permissions

Add these before building for a device.

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
