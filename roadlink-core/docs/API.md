# RoadLink Core — API reference

Base URL: `/api/v1` · JSON in, JSON out · Auth: `Authorization: Bearer <jwt>` (from `POST /auth/login`).

Errors always look like `{ "error": { "code": "AMBULANCE_UNAVAILABLE", "message": "..." } }`.
Clients should branch on `code`, not `message`.

## Roles

| Role | Used by | Sees |
|---|---|---|
| *(none)* | RoadLink Reporter (citizen) | Only the minimal public view of an incident they hold the id of |
| `police` | RoadLink Police | Incidents assigned to their unit |
| `ambulance` | RoadLink Ambulance | Incidents assigned to their vehicle |
| `hospital` | RoadLink Hospital | Incidents assigned to their hospital |
| `dispatcher` | RoadLink Dispatch | Everything (including reporter phone numbers) |
| `admin` | RoadLink Admin | Everything, plus management endpoints |

Reporter phone numbers are only ever returned to `dispatcher` / `admin`.

## Incident statuses

`reported → policeNotified → policeOnScene → ambulanceAssigned → ambulanceEnRoute → ambulanceOnScene → transporting → hospitalNotified → admitted → closed`

These camelCase strings are exactly what the Flutter app's `IncidentStatus` enum parses. Severity values: `minor | serious | critical | fatal`.

**The headline status only moves forward.** Police, ambulance and hospital work in parallel, so events can arrive "out of order" (e.g. hospital notified before police are on scene). A late, lower-ranked event is still written to the audit trail but never makes the citizen-visible status go backwards.

## Auth

| Method & path | Role | Notes |
|---|---|---|
| `POST /auth/login` | – | `{ identifier, password }` (email or phone) → `{ token, user }` |
| `GET /auth/me` | any staff | |
| `PUT /auth/fcm-token` | any staff | `{ token }` — register/clear the device push token |
| `POST /auth/change-password` | any staff | `{ current_password, new_password }` |

## Incidents

| Method & path | Role | Body / notes |
|---|---|---|
| `POST /incidents` | none, or dispatcher | `{ lat, lng, severity, victim_count?, description? }`. Dispatchers may add `reporter_phone`, `location_accuracy`, `location_label` (phoned-in reports). **201** = new incident, **200** with `merged: true` = merged into an existing nearby open incident (default 150 m / 30 min). Rate limited per IP for anonymous callers. |
| `GET /incidents?status=open\|all\|<status>&limit&offset` | staff | Scoped to the caller's role |
| `GET /incidents/:id` | none or staff | Anonymous → public view; staff → full view if assigned |
| `GET /incidents/:id/timeline` | staff | Full audit trail |
| `GET /incidents/:id/recommendations` | dispatcher, admin | `{ ambulances[], hospitals[] }` ranked by distance; hospitals with no free trauma bays are ranked last |
| `POST /incidents/:id/photo` | none | multipart field `photo` (JPEG/PNG/WebP, ≤ 5 MB, content verified). One per incident |
| `GET /incidents/:id/photo` | assigned staff | |

### Police
| Path | Notes |
|---|---|
| `POST /incidents/:id/police/accept` | |
| `POST /incidents/:id/police/decline` | `{ reason? }` → next-nearest unit is alerted automatically |
| `POST /incidents/:id/police/on-scene` | |
| `PATCH /incidents/:id/scene` | `{ verified_victim_count?, hazard_notes?, severity? }` |
| `POST /incidents/:id/police/clear` | frees the unit |
| `PUT /incidents/:id/case-reference` | `{ reference_number }` — allowed even after the incident is closed |

### Dispatcher
| Path | Notes |
|---|---|
| `POST /incidents/:id/ambulance` | `{ ambulance_id?, force? }` — omit `ambulance_id` to take the best available ambulance: recent GPS first, then nearest (a position older than `STALE_LOCATION_MIN` is only used when nothing fresher is free). Atomic: two dispatchers cannot claim the same ambulance (loser gets `409 AMBULANCE_UNAVAILABLE`). Replacing an ambulance that is already on scene or transporting is refused with `409 AMBULANCE_ON_JOB` unless `force: true` (for example a breakdown). Returns `eta_minutes` |
| `POST /incidents/:id/hospital` | `{ hospital_id? }` — omit to take the top recommendation. Returns `eta_minutes` and `warnings[]` (e.g. no free bays) |
| `POST /incidents/:id/close` | `{ outcome?: completed\|no_transport\|false_alarm\|cancelled, note? }`. `completed` requires hospital admission first; use `no_transport` when nobody is taken to hospital (for example a fatality). Releases ambulance and police unit |

### Ambulance crew
| Path | Notes |
|---|---|
| `POST /incidents/:id/ambulance/status` | `{ status: enRoute\|onScene\|transporting\|arrived }` — forward only |

### Hospital
| Path | Notes |
|---|---|
| `POST /incidents/:id/hospital/acknowledge` | |
| `POST /incidents/:id/hospital/admit` | |

## Resources

| Method & path | Role | Notes |
|---|---|---|
| `GET /hospitals` | staff | with free/total trauma bays |
| `PATCH /hospitals/me/capacity` | hospital | `{ trauma_bays_free, trauma_bays_total? }` |
| `GET /ambulances` | dispatcher, admin | positions + availability |
| `GET /ambulances/me` | ambulance | own vehicle + `is_available` (for the on-duty toggle at startup) |
| `PATCH /ambulances/me/location` | ambulance | `{ lat, lng }` — send every ~10–15 s while on duty |
| `PATCH /ambulances/me/availability` | ambulance | `{ is_available }` — refused mid-job |
| `GET /police-units` | dispatcher, admin | |
| `GET /police-units/me` | police | own unit + `is_available` |
| `PATCH /police-units/me/location` | police | `{ lat, lng }` |
| `PATCH /police-units/me/availability` | police | `{ is_available }` |

## Admin (`admin` only)

`POST/GET /admin/users`, `PATCH /admin/users/:id` (deactivate rather than delete) ·
`POST /admin/hospitals`, `PATCH /admin/hospitals/:id` ·
`POST /admin/ambulances`, `PATCH /admin/ambulances/:id` ·
`POST /admin/police-units`, `PATCH /admin/police-units/:id` ·
`GET /admin/reports/summary?from&to` — counts and average response intervals computed from the audit trail.

## USSD

`POST /ussd?key=<USSD_SECRET>` — Africa's Talking callback format (form-encoded `sessionId, serviceCode, phoneNumber, text`). Replies `CON …` / `END …`. USSD has no GPS, so the reporter picks an area from a list; the incident is stored with `location_accuracy: "approximate"` and the caller's number so the dispatcher can phone back to confirm the exact spot.

## Real-time (Socket.IO)

Connect to the server root. Staff: `io(url, { auth: { token } })`. Citizens: connect with no token, then `socket.emit('watch', incidentId, ack)`.

| Event | Sent to | Payload |
|---|---|---|
| `incident:new` | dispatch/admin; the alerted police unit | `{ event, incident }` |
| `incident:update` | dispatch/admin; assigned police/ambulance/hospital; the citizen who watches that incident | `{ event, incident }` — citizens get the public view only |
| `incident:unassigned` | a resource that was removed from an incident (police decline, ambulance/hospital reassigned) | `{ incident_id }` |
| `resource:location` | dispatch/admin | `{ kind: 'ambulance'\|'police', id, lat, lng, at }` |
| `hospital:capacity` | dispatch/admin | hospital row |
| `auth:expired` | the staff socket | sent just before the server disconnects it |

`event` values on the socket: `incident_created`, `duplicate_report_merged`, `police_notified`, `police_accepted`, `police_declined`, `police_escalated`, `police_unresponsive`, `police_on_scene`, `scene_updated`, `scene_cleared`, `case_reference_recorded`, `ambulance_assigned`, `ambulance_en_route`, `ambulance_on_scene`, `ambulance_transporting`, `ambulance_arrived_at_hospital`, `hospital_notified`, `hospital_acknowledged`, `patient_admitted`, `incident_closed`, `photo_attached`.

The audit trail (`GET /incidents/:id/timeline`) is slightly finer-grained: it also distinguishes `ambulance_reassigned`, `hospital_reassigned` and `incident_closed_completed|no_transport|false_alarm|cancelled`.

`police_escalated` is written when the alerted unit did not accept or decline within `POLICE_ACK_TIMEOUT_MIN` and the next nearest unit was alerted. `police_unresponsive` means no other unit was left, so dispatch should phone the station; it is raised once per alert.

Push (FCM) is sent to police on new incidents, to the ambulance crew on assignment/cancellation, and to the hospital on pre-arrival notice.
