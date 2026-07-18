-- Robot code deploy log: what firmware/software build ran during which match or test session.
-- Distinct from 0225 code_perf (which correlates logged code CHANGES against match performance
-- deltas); this is the literal deploy record — version/commit deployed, when, and to which match —
-- so a team can answer "what code was running during qm42" after the fact.

CREATE TABLE code_deploy_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  deployed_on date NOT NULL,
  match_key text,
  event_key text,
  firmware_version text NOT NULL,
  commit_sha text,
  branch text,
  deploy_type text NOT NULL DEFAULT 'practice'
    CHECK (deploy_type IN ('practice', 'qualification', 'elimination', 'pit_test', 'other')),
  status text NOT NULL DEFAULT 'deployed'
    CHECK (status IN ('deployed', 'rolled_back', 'failed')),
  notes text,
  deployed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX code_deploy_log_entries_org_season_idx
  ON code_deploy_log_entries(org_id, season_year, deployed_on DESC);
CREATE INDEX code_deploy_log_entries_org_match_idx
  ON code_deploy_log_entries(org_id, match_key);

ALTER TABLE code_deploy_log_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY code_deploy_log_entries_member_read ON code_deploy_log_entries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY code_deploy_log_entries_member_insert ON code_deploy_log_entries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND deployed_by = current_app_user_id());
CREATE POLICY code_deploy_log_entries_member_update ON code_deploy_log_entries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY code_deploy_log_entries_member_delete ON code_deploy_log_entries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON code_deploy_log_entries TO vantage_app, vantage_worker;
