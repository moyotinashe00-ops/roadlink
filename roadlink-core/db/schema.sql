-- RoadLink Core — database schema (PostgreSQL 14+ with PostGIS 3)
-- Implements the entity model from SRS section 5. Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('dispatcher', 'police', 'ambulance', 'hospital', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Resources
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  location         GEOGRAPHY(Point, 4326) NOT NULL,
  contact_number   TEXT,
  trauma_bays_total INT NOT NULL DEFAULT 0 CHECK (trauma_bays_total >= 0),
  trauma_bays_free  INT NOT NULL DEFAULT 0 CHECK (trauma_bays_free >= 0),
  capacity_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS hospitals_location_gix ON hospitals USING GIST (location);

CREATE TABLE IF NOT EXISTS police_units (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  station          TEXT,
  coverage_area    TEXT,
  location         GEOGRAPHY(Point, 4326),          -- last known position
  location_updated_at TIMESTAMPTZ,
  is_available     BOOLEAN NOT NULL DEFAULT TRUE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS police_units_location_gix ON police_units USING GIST (location);

CREATE TABLE IF NOT EXISTS ambulances (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number     TEXT NOT NULL UNIQUE,
  provider         TEXT,
  location         GEOGRAPHY(Point, 4326),
  location_updated_at TIMESTAMPTZ,
  is_available     BOOLEAN NOT NULL DEFAULT TRUE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS ambulances_location_gix ON ambulances USING GIST (location);

-- ---------------------------------------------------------------------------
-- Users (staff only — citizens report without an account, SRS CIT-01)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  phone          TEXT UNIQUE,
  email          TEXT UNIQUE,
  password_hash  TEXT NOT NULL,
  role           user_role NOT NULL,
  hospital_id    UUID REFERENCES hospitals(id),
  police_unit_id UUID REFERENCES police_units(id),
  ambulance_id   UUID REFERENCES ambulances(id),
  fcm_token      TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_login_identifier CHECK (phone IS NOT NULL OR email IS NOT NULL),
  -- a staff account must be tied to the resource its role acts for
  CONSTRAINT users_role_binding CHECK (
    (role = 'hospital'  AND hospital_id    IS NOT NULL) OR
    (role = 'police'    AND police_unit_id IS NOT NULL) OR
    (role = 'ambulance' AND ambulance_id   IS NOT NULL) OR
    (role IN ('dispatcher', 'admin'))
  )
);

-- ---------------------------------------------------------------------------
-- Incidents
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS incident_ref_seq START 1;

-- Status strings are camelCase on purpose: they are the exact values the
-- Flutter app's IncidentStatus enum parses (see lib/models/incident.dart).
CREATE TABLE IF NOT EXISTS incidents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number    TEXT NOT NULL UNIQUE
                      DEFAULT ('RL-' || to_char(now(), 'YY') || lpad(nextval('incident_ref_seq')::text, 5, '0')),
  location            GEOGRAPHY(Point, 4326) NOT NULL,
  location_accuracy   TEXT NOT NULL DEFAULT 'gps' CHECK (location_accuracy IN ('gps', 'approximate')),
  location_label      TEXT,                          -- e.g. suburb name for USSD reports
  severity            TEXT NOT NULL CHECK (severity IN ('minor', 'serious', 'critical', 'fatal')),
  victim_count        INT  NOT NULL DEFAULT 1 CHECK (victim_count BETWEEN 0 AND 500),
  verified_victim_count INT CHECK (verified_victim_count BETWEEN 0 AND 500),
  description         TEXT NOT NULL DEFAULT '',
  hazard_notes        TEXT,
  photo_path          TEXT,
  status              TEXT NOT NULL DEFAULT 'reported' CHECK (status IN (
                        'reported', 'policeNotified', 'policeOnScene', 'ambulanceAssigned',
                        'ambulanceEnRoute', 'ambulanceOnScene', 'transporting',
                        'hospitalNotified', 'admitted', 'closed')),
  source              TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'ussd', 'voice')),
  reporter_phone      TEXT,
  report_count        INT NOT NULL DEFAULT 1,        -- >1 when duplicate reports were merged
  created_by          UUID REFERENCES users(id),     -- set when a dispatcher enters a phoned-in report
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS incidents_location_gix ON incidents USING GIST (location);
CREATE INDEX IF NOT EXISTS incidents_status_idx   ON incidents (status);
CREATE INDEX IF NOT EXISTS incidents_created_idx  ON incidents (created_at DESC);

-- One assignment row per incident, linking the police unit, ambulance and hospital.
CREATE TABLE IF NOT EXISTS assignments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id          UUID NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
  police_unit_id       UUID REFERENCES police_units(id),
  police_state         TEXT CHECK (police_state IN ('notified', 'accepted', 'onScene', 'cleared')),
  declined_police_unit_ids UUID[] NOT NULL DEFAULT '{}',
  ambulance_id         UUID REFERENCES ambulances(id),
  ambulance_state      TEXT CHECK (ambulance_state IN ('assigned', 'enRoute', 'onScene', 'transporting', 'arrived')),
  ambulance_eta_minutes INT,
  hospital_id          UUID REFERENCES hospitals(id),
  hospital_eta_minutes INT,
  hospital_state       TEXT CHECK (hospital_state IN ('notified', 'acknowledged', 'admitted')),
  police_assigned_at   TIMESTAMPTZ,
  police_escalated     BOOLEAN NOT NULL DEFAULT FALSE,  -- dispatch already told that no unit answered
  ambulance_assigned_at TIMESTAMPTZ,
  hospital_assigned_at TIMESTAMPTZ
);
-- Databases created before escalation existed:
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS police_escalated BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS case_references (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id      UUID NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
  reference_number TEXT NOT NULL,
  recorded_by      UUID REFERENCES users(id),
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit trail (SRS COR-05): every state change, who made it, and when.
CREATE TABLE IF NOT EXISTS status_updates (
  id            BIGSERIAL PRIMARY KEY,
  incident_id   UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id),
  actor_role    TEXT NOT NULL,                       -- a user role, or 'citizen' / 'ussd' / 'system'
  event         TEXT NOT NULL,                       -- e.g. 'incident_created', 'ambulance_assigned'
  old_status    TEXT,
  new_status    TEXT NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS status_updates_incident_idx ON status_updates (incident_id, created_at);

-- Known areas used to place USSD reports, which carry no GPS (see routes/ussd.js).
CREATE TABLE IF NOT EXISTS known_areas (
  id        SERIAL PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  location  GEOGRAPHY(Point, 4326) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);
