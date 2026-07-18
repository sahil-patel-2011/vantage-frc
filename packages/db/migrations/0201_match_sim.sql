-- Match Simulator: deterministic full-field score-timeline simulations built from an org's
-- own scouted alliance selections plus the shared TBA/Statbotics EPA cache (team_event_metrics /
-- team_year_metrics, see 0002_global_reference.sql). Stores each saved simulation run and its
-- computed result snapshot (timeline + single highest-leverage lever) so a coach can revisit it.

CREATE TABLE match_sim_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '',
  event_key text,
  match_key text,
  red_team_keys text[] NOT NULL CHECK (array_length(red_team_keys, 1) BETWEEN 1 AND 4),
  blue_team_keys text[] NOT NULL CHECK (array_length(blue_team_keys, 1) BETWEEN 1 AND 4),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX match_sim_runs_org_created_idx ON match_sim_runs(org_id, created_at DESC);

ALTER TABLE match_sim_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_sim_runs_member_read ON match_sim_runs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY match_sim_runs_member_insert ON match_sim_runs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY match_sim_runs_member_update ON match_sim_runs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY match_sim_runs_member_delete ON match_sim_runs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON match_sim_runs TO vantage_app, vantage_worker;
