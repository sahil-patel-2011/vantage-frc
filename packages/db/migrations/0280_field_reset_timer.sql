-- Field Reset Timer: practice field-reset & cycle timer tool for driver practice.
-- Sessions group timed reset cycles logged during a single practice block; cycles capture
-- the reset time (and optional full drive-cycle time) for each rep so drive teams can see
-- whether reset speed and consistency are actually improving across sessions.

CREATE TABLE field_reset_timer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  occurred_on date NOT NULL,
  season_year integer NOT NULL,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX field_reset_timer_sessions_org_season_idx
  ON field_reset_timer_sessions(org_id, season_year, occurred_on DESC);

ALTER TABLE field_reset_timer_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY field_reset_timer_sessions_member_read ON field_reset_timer_sessions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY field_reset_timer_sessions_member_insert ON field_reset_timer_sessions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY field_reset_timer_sessions_member_update ON field_reset_timer_sessions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY field_reset_timer_sessions_member_delete ON field_reset_timer_sessions FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON field_reset_timer_sessions TO vantage_app, vantage_worker;

CREATE TABLE field_reset_timer_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES field_reset_timer_sessions(id) ON DELETE CASCADE,
  cycle_number integer NOT NULL CHECK (cycle_number > 0),
  reset_seconds numeric(6,2) NOT NULL CHECK (reset_seconds >= 0),
  cycle_seconds numeric(6,2) CHECK (cycle_seconds IS NULL OR cycle_seconds >= 0),
  note text,
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX field_reset_timer_cycles_org_session_idx
  ON field_reset_timer_cycles(org_id, session_id, cycle_number);

ALTER TABLE field_reset_timer_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY field_reset_timer_cycles_member_read ON field_reset_timer_cycles FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY field_reset_timer_cycles_member_insert ON field_reset_timer_cycles FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND recorded_by = current_app_user_id());
CREATE POLICY field_reset_timer_cycles_member_update ON field_reset_timer_cycles FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY field_reset_timer_cycles_member_delete ON field_reset_timer_cycles FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON field_reset_timer_cycles TO vantage_app, vantage_worker;
