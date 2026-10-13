# RoadLink field apps: Police and Ambulance

Two Flutter apps for **RoadLink ZW** (SRS §2.3, requirements **POL-01 – POL-07** and **AMB-01 – AMB-06**), built on one shared
package so they stay consistent and each app is only its own screens.

```
packages/roadlink_shared/   models · API client · Socket.IO client · location sharing · FieldController · login · map · widgets
apps/roadlink_police/       police home + incident screen          (accent: patrol blue)
apps/roadlink_ambulance/    ambulance home + job screen            (accent: siren red)
tools/contract_check.mjs    verifies this code against a running RoadLink Core (see "What was verified")
```

They talk only to [RoadLink Core](../roadlink-core); the Hospital portal is a separate web app (`roadlink-hospital`).

## What each app does

**Police**: the nearest available unit is alerted the moment a citizen reports. A full-screen alert (with haptics) offers
*Accept / Can't attend / Later*. "Can't attend" asks for a reason and the backend passes the incident to the next-nearest unit.
Then: navigate → *I'm on scene* → update scene (confirmed patient count, severity, hazards) → *Scene cleared* → record the
police case number. Shows the live ambulance/hospital status and warns when a USSD report's location is only approximate.
On-duty toggle; the unit's position is shared with dispatch.

**Ambulance**: standby screen with the on-duty toggle; a new job triggers an alert. The job screen has a map (scene + receiving
hospital), patient count and hazards, and **one big button that walks the crew through the irreversible steps**:
*Start en route → Arrived on scene → Patient loaded → Arrived at hospital*. It is **hold-to-confirm** (0.8 s) so a bump or pocket-press
on a moving vehicle cannot advance the job. "Navigate" points at the scene, then switches to the hospital once the patient is
loaded; one-tap call to dispatch and to the hospital. Afterwards, *Ready for next job* puts the vehicle back on the dispatch list.

Both: live updates over Socket.IO with a **15-second polling fallback** (and re-sync on reconnect), secure token storage
(Keystore/Keychain), automatic sign-out when the session expires, and a banner when the connection or GPS is lost.

## Run it

Needs Flutter ≥ 3.19 (Dart 3). This repo ships `pubspec.yaml` + `lib/`; generate the native projects once per app:

```bash
cd apps/roadlink_police            # and again for apps/roadlink_ambulance
flutter create --org zw.co.roadlink --project-name roadlink_police --platforms=android,ios .
git diff --stat                    # confirm it did not overwrite lib/ or pubspec.yaml; restore them if it did
flutter pub get
flutter run --dart-define=ROADLINK_API=http://10.0.2.2:3000     # 10.0.2.2 = your computer, from the Android emulator
#   real phone on the same Wi-Fi:  --dart-define=ROADLINK_API=http://192.168.x.x:3000
#   ambulance only (optional):     --dart-define=DISPATCH_NUMBER=+2637xxxxxxx
```
Start the backend first (`npm run db:seed && npm start` in roadlink-core). Demo logins, password `ChangeMe123!`:
`police1@roadlink.zw` (Harare Central), `police2@` (Highlands), `ambulance1@roadlink.zw` (ADX-1001), `ambulance2@` (ADX-1002).

### Native configuration you must add

**Android**: `android/app/src/main/AndroidManifest.xml`, inside `<manifest>`:
```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION"/>
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<uses-permission android:name="android.permission.VIBRATE"/>
<queries>
  <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="tel"/></intent>
  <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="https"/></intent>
</queries>
```
On `<application>` add `android:usesCleartextTraffic="true"` **for local http development only** (use HTTPS in production).
In `android/app/build.gradle(.kts)` set `minSdk = 23` (required by `flutter_secure_storage`).

**iOS**: `ios/Runner/Info.plist`:
```xml
<key>NSLocationWhenInUseUsageDescription</key><string>RoadLink shares your position with dispatch.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key><string>RoadLink shares your position with dispatch while on duty.</string>
<key>UIBackgroundModes</key><array><string>location</string></array>
<key>LSApplicationQueriesSchemes</key><array><string>tel</string><string>https</string></array>
```

## What was verified, and what was NOT

**Verified, against a live RoadLink Core (`tools/contract_check.mjs`)**: the check reads the Dart source itself, so it cannot drift.
- every one of the **19 endpoints** in `api_client.dart` exists on the server;
- every JSON key `models.dart` reads exists in real police and ambulance payloads, and no field the Dart code casts as non-null is ever null;
- the real workflow the apps drive (accept → on scene → scene update → case number; crew steps `enRoute → onScene → transporting → arrived`;
  decline/reassign; "ready for next job") is accepted by the server;
- the live Socket.IO payload has the `{ event, incident }` shape `realtime.dart` parses;
- a negative control (deliberately misspelling a key and a route) makes the check fail, so a green run means something.
All 18 Dart files also **parse cleanly** with a Dart grammar parser.

**NOT verified, so treat as untested until you run it**:
- **The Dart code has never been compiled or run.** There is no Flutter/Dart SDK in the environment this was built in. A syntax parse
  and a manual null-safety review (which caught and fixed one real compile error) are not a compiler. Expect to fix a few
  analyzer errors, most likely package-API details (`socket_io_client`'s `setAuth`, `flutter_map` v7's `darkModeTileBuilder`,
  `geolocator`'s `AndroidSettings`). Run `flutter analyze` first.
- No visual check on a device or emulator, and no Flutter unit/widget tests yet.

## Known gaps (read before field use)

1. **No push notifications on the phone yet. This is the biggest gap.** The backend already sends FCM pushes and stores tokens
   (`PUT /auth/fcm-token`), but these apps do not register for them. Alerts therefore only arrive while the app is open and connected.
   The ambulance app's location foreground-service helps keep it alive on Android, but that is not a guarantee, and the police app
   has no such help. To fix: add `firebase_messaging`, a Firebase project + `google-services.json` / `GoogleService-Info.plist`,
   register the token after login, and handle notification taps. It needs your Firebase project, so it is not included.
2. **Map tiles are OpenStreetMap's public servers**, fine for development but against their usage policy at scale. Use a commercial
   or self-hosted tile provider in production. Navigation hands off to the phone's Google Maps app (no API key needed).
3. **Location sharing is foreground-oriented.** Android keeps it running with the screen off via the foreground-service notification
   (ambulance only). iOS "always" permission and App Store review of background location are not handled.
4. **No offline queue, by design** (the revised SRS dropped offline-first): if a status tap fails, the app shows the server's message
   and the crew retries or phones dispatch. A bad-signal hold-to-confirm that fails is not silently retried.
5. English only; one ambulance per incident (a backend limitation); fonts load from Google Fonts at runtime (bundle them for poor networks).
