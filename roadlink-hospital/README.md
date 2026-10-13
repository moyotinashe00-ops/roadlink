# RoadLink Hospital

Emergency-department intake board for **RoadLink ZW** (SRS §2.3 "RoadLink Hospital", requirements **HOS-01 – HOS-06**).
React 19 + Vite, talking to [RoadLink Core](../roadlink-core) over REST and Socket.IO.

## Run it

```bash
cp .env.example .env        # VITE_API_URL=http://localhost:3000
npm install
npm run dev                 # http://localhost:5175  (this port is already in the backend's CORS_ORIGINS)
```
Demo login (after `npm run db:seed` in roadlink-core): `hospital2@roadlink.zw` / `ChangeMe123!` (Harare Central) or `hospital1@…` (Parirenyatwa).

## What it does

| Requirement | Where |
|---|---|
| HOS-01 notified the moment dispatch assigns this hospital | live Socket.IO event → new card, chime, tab-title badge `(1) Incoming` |
| HOS-02 ETA, patient count, severity | `IncidentCard` + the draining **ETA ring** (counts down from the time the hospital was notified; turns amber when close, pulses `+mm:ss` when overdue; shows **AT DOOR** when the crew marks arrival) |
| HOS-03 acknowledge | "Acknowledge & prepare" |
| HOS-04 mark admitted | two-step ("Mark admitted" → "Confirm: patient received") so a mis-click cannot close the loop for dispatch |
| HOS-05 capacity | trauma-bay pips + steppers; the free count is what dispatch's hospital ranking uses |
| HOS-06 history | "Recently received" column + per-incident audit **Timeline** drawer |

Also: police-confirmed patient counts and hazard notes are shown on the card; a **polling fallback** (every 15 s) runs while the
socket is down and the board re-syncs on reconnect, so a dropped connection delays updates but never loses them (SRS §7.3).
The server only ever sends this hospital its own incidents, and never the reporter's phone number.

## Tests

```bash
npm test                    # 24 tests: board logic, ETA maths, API client, and the full UI flow (network + socket mocked)
npm run contract            # NO mocks: drives this app's real api/realtime code against a running RoadLink Core
                            #   (start the backend with demo data first; set CONTRACT_API_URL if not on :3000)
```

## Limitations

- **Not visually tested in a real browser** in the environment this was built in: the build, logic, component tests and the live
  contract check all pass, but look at it in Chrome/Edge before demoing and expect small CSS tweaks.
- Browsers only allow the alert chime after the user has interacted with the page (the sign-in click counts). If the tab is
  closed or the PC is asleep nothing alerts: use RoadLink's phone-call fallback. Web push for closed tabs is not built.
- The session lives in `sessionStorage` (cleared when the tab closes) on purpose, for shared ED-desk machines.
- Fonts load from Google Fonts; self-host them if the hospital network is restricted.
- English only for now; strings are in the components and easy to extract for Shona/Ndebele.
