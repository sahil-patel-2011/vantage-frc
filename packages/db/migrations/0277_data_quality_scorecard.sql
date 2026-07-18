-- Data Quality Scorecard: org-logged scouting data-quality checks over the season.
-- Each row is one quality check against a scouting record (a match/pit entry a scout filed) —
-- how complete it was against the expected field set (coverage), whether a cross-check with
-- another scout's record on the same match agreed (disagreement), and how far the scout's
-- reported value deviated from the team consensus/baseline at that time (drift signal).
-- The scorecard view aggregates these checks; it never fabricates metrics for events with none logged.

CREATE TABLE data_quality_scorecard_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  match_key text,
  scout_name text NOT NULL,
  check_date date NOT NULL,
  expected_data_points integer NOT NULL DEFAULT 0 CHECK (expected_data_points >= 0),
  captured_data_points integer NOT NULL DEFAULT 0 CHECK (captured_data_points >= 0),
  cross_checked boolean NOT NULL DEFAULT false,
  agreement boolean,
  deviation_score numeric(5, 4) CHECK (deviation_score IS NULL OR (deviation_score >= 0 AND deviation_score <= 1)),
  season_year integer NOT NULL,
  notes text,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (captured_data_points <= expected_data_points OR expected_data_points = 0)
);
CREATE INDEX data_quality_scorecard_checks_org_season_idx
  ON data_quality_scorecard_checks(org_id, season_year, check_date DESC);
CREATE INDEX data_quality_scorecard_checks_org_event_idx
  ON data_quality_scorecard_checks(org_id, event_key);

ALTER TABLE data_quality_scorecard_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY data_quality_scorecard_checks_member_read ON data_quality_scorecard_checks FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY data_quality_scorecard_checks_member_insert ON data_quality_scorecard_checks FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY data_quality_scorecard_checks_member_update ON data_quality_scorecard_checks FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY data_quality_scorecard_checks_member_delete ON data_quality_scorecard_checks FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON data_quality_scorecard_checks TO vantage_app, vantage_worker;
