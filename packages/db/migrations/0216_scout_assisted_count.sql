-- Scout-assisted count: human-marks/machine-counts assisted counting. A scout taps a big
-- on-screen button during a match instead of typing a number; each tap is logged with its
-- timestamp (raw tap log) and the session's running tally auto-fills the numeric scouting
-- field. Distinct from 0211 scout_coverage_live (assignment coverage) and the scouting
-- package's match-entry forms (final submitted values) — this is the raw counting instrument
-- that feeds a value into that form.

CREATE TABLE scout_assisted_count_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  match_key text,
  team_key text,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  tap_count integer NOT NULL DEFAULT 0 CHECK (tap_count >= 0),
  started_by uuid NOT NULL REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX scout_assisted_count_sessions_org_idx
  ON scout_assisted_count_sessions(org_id, started_at DESC);

CREATE TABLE scout_assisted_count_taps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES scout_assisted_count_sessions(id) ON DELETE CASCADE,
  delta integer NOT NULL DEFAULT 1,
  tapped_by uuid NOT NULL REFERENCES users(id),
  tapped_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scout_assisted_count_taps_session_idx
  ON scout_assisted_count_taps(session_id, tapped_at);

ALTER TABLE scout_assisted_count_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_assisted_count_taps ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_assisted_count_sessions_member_read ON scout_assisted_count_sessions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_assisted_count_sessions_member_insert ON scout_assisted_count_sessions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND started_by = current_app_user_id());
CREATE POLICY scout_assisted_count_sessions_member_update ON scout_assisted_count_sessions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_assisted_count_sessions_member_delete ON scout_assisted_count_sessions FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY scout_assisted_count_taps_member_read ON scout_assisted_count_taps FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_assisted_count_taps_member_insert ON scout_assisted_count_taps FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND tapped_by = current_app_user_id());
CREATE POLICY scout_assisted_count_taps_member_update ON scout_assisted_count_taps FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_assisted_count_taps_member_delete ON scout_assisted_count_taps FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_assisted_count_sessions TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON scout_assisted_count_taps TO vantage_app, vantage_worker;
