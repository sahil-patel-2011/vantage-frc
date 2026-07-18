-- Team Attendance (practice / meeting presence log).
-- Org-scoped events with named attendees and optional credited hours.
-- Distinct from build-hours clock-in (shop time) when that module is present.

CREATE TABLE attendance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  kind text NOT NULL DEFAULT 'meeting'
    CHECK (kind IN ('meeting', 'build', 'competition', 'outreach', 'other')),
  occurred_on date NOT NULL,
  credit_hours numeric(6, 2) NOT NULL DEFAULT 0 CHECK (credit_hours >= 0),
  season_year integer NOT NULL CHECK (season_year BETWEEN 1992 AND 3000),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendance_events_org_idx ON attendance_events(org_id, occurred_on DESC);
CREATE INDEX attendance_events_season_idx ON attendance_events(org_id, season_year, occurred_on DESC);

CREATE TABLE attendance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES attendance_events(id) ON DELETE CASCADE,
  person_name text NOT NULL CHECK (char_length(person_name) BETWEEN 1 AND 160),
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'mentor', 'other')),
  hours numeric(6, 2) CHECK (hours IS NULL OR hours >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendance_entries_event_idx ON attendance_entries(event_id);
CREATE INDEX attendance_entries_org_idx ON attendance_entries(org_id, person_name);

ALTER TABLE attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY attendance_events_member_read ON attendance_events
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY attendance_events_member_insert ON attendance_events
  FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
CREATE POLICY attendance_events_member_update ON attendance_events
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
CREATE POLICY attendance_events_member_delete ON attendance_events
  FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY attendance_entries_member_read ON attendance_entries
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY attendance_entries_member_write ON attendance_entries
  FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_events, attendance_entries
  TO vantage_app, vantage_worker;
