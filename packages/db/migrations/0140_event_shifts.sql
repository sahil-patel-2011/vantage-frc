-- Shift Scheduler: competition-day staffing — who covers which role during which time block.
-- The app merges assigned intervals per role/day and flags coverage gaps. Season-scoped, RLS.

CREATE TABLE IF NOT EXISTS event_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  role text NOT NULL DEFAULT 'other'
    CHECK (role IN ('drive_team','pit_crew','scout','queue','human_player','safety','stands','other')),
  person_name text NOT NULL,
  day date NOT NULL,
  start_min integer NOT NULL CHECK (start_min BETWEEN 0 AND 1440),
  end_min integer NOT NULL CHECK (end_min BETWEEN 0 AND 1440),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_min > start_min)
);
CREATE INDEX IF NOT EXISTS event_shifts_org_season_day_idx ON event_shifts(org_id, season_year, day, start_min);

ALTER TABLE event_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_shifts_member_read ON event_shifts;
DROP POLICY IF EXISTS event_shifts_member_insert ON event_shifts;
DROP POLICY IF EXISTS event_shifts_member_update ON event_shifts;
DROP POLICY IF EXISTS event_shifts_member_delete ON event_shifts;
CREATE POLICY event_shifts_member_read ON event_shifts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY event_shifts_member_insert ON event_shifts FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY event_shifts_member_update ON event_shifts FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY event_shifts_member_delete ON event_shifts FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON event_shifts TO vantage_app, vantage_worker;
