-- Code-vs-match regression detective: log software/tuning changes (commits, software-version
-- bumps, mechanism tuning) and match-by-match auto/teleop performance, then correlate the two
-- so a team can see whether a given change actually improved or regressed on-field performance.

CREATE TABLE code_perf_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  occurred_on date NOT NULL,
  change_type text NOT NULL DEFAULT 'commit'
    CHECK (change_type IN ('commit', 'software_version', 'tuning')),
  subsystem text NOT NULL DEFAULT 'general'
    CHECK (subsystem IN ('drivetrain', 'intake', 'shooter', 'climber', 'vision', 'autonomous', 'general', 'other')),
  title text NOT NULL,
  commit_sha text,
  repo_url text,
  description text,
  -- Analysis columns: populated by the deterministic (metered, zero-provider-cost) correlation
  -- computed from code_perf_match_results before/after this change's occurred_on.
  verdict text NOT NULL DEFAULT 'insufficient_data'
    CHECK (verdict IN ('improved', 'regressed', 'neutral', 'insufficient_data')),
  delta_auto numeric,
  delta_teleop numeric,
  delta_total numeric,
  matches_before integer NOT NULL DEFAULT 0,
  matches_after integer NOT NULL DEFAULT 0,
  rationale text,
  analyzed_at timestamptz,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX code_perf_changes_org_season_idx ON code_perf_changes(org_id, season_year, occurred_on DESC);

ALTER TABLE code_perf_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY code_perf_changes_member_read ON code_perf_changes FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY code_perf_changes_member_insert ON code_perf_changes FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY code_perf_changes_member_update ON code_perf_changes FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY code_perf_changes_member_delete ON code_perf_changes FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON code_perf_changes TO vantage_app, vantage_worker;

CREATE TABLE code_perf_match_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  occurred_on date NOT NULL,
  match_key text NOT NULL,
  event_key text,
  auto_points numeric NOT NULL DEFAULT 0 CHECK (auto_points >= 0),
  teleop_points numeric NOT NULL DEFAULT 0 CHECK (teleop_points >= 0),
  endgame_points numeric NOT NULL DEFAULT 0 CHECK (endgame_points >= 0),
  notes text,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX code_perf_match_results_org_season_idx ON code_perf_match_results(org_id, season_year, occurred_on DESC);
CREATE UNIQUE INDEX code_perf_match_results_org_match_key_idx ON code_perf_match_results(org_id, match_key);

ALTER TABLE code_perf_match_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY code_perf_match_results_member_read ON code_perf_match_results FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY code_perf_match_results_member_insert ON code_perf_match_results FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY code_perf_match_results_member_update ON code_perf_match_results FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY code_perf_match_results_member_delete ON code_perf_match_results FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON code_perf_match_results TO vantage_app, vantage_worker;
