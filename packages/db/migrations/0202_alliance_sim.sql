-- Alliance Sim: playoff-alliance endgame conflict & role simulator. Teams declare which
-- physical endgame/scoring roles each robot on a prospective alliance can fill; the compute
-- layer greedily assigns roles under capacity, flags physical conflicts (more capable robots
-- than the role has room for), and derives a win-probability estimate from real coverage —
-- never fabricated per-team stats.

CREATE TABLE alliance_sim_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  event_name text,
  season_year integer NOT NULL,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alliance_sim_scenarios_org_idx ON alliance_sim_scenarios(org_id, created_at DESC);

ALTER TABLE alliance_sim_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY alliance_sim_scenarios_member_read ON alliance_sim_scenarios FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY alliance_sim_scenarios_member_insert ON alliance_sim_scenarios FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY alliance_sim_scenarios_member_update ON alliance_sim_scenarios FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY alliance_sim_scenarios_member_delete ON alliance_sim_scenarios FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON alliance_sim_scenarios TO vantage_app, vantage_worker;

CREATE TABLE alliance_sim_robots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES alliance_sim_scenarios(id) ON DELETE CASCADE,
  team_number integer NOT NULL CHECK (team_number > 0),
  team_name text,
  capable_roles text[] NOT NULL DEFAULT '{}',
  role_strengths jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alliance_sim_robots_scenario_idx ON alliance_sim_robots(scenario_id, created_at ASC);
CREATE INDEX alliance_sim_robots_org_idx ON alliance_sim_robots(org_id);

ALTER TABLE alliance_sim_robots ENABLE ROW LEVEL SECURITY;

CREATE POLICY alliance_sim_robots_member_read ON alliance_sim_robots FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY alliance_sim_robots_member_insert ON alliance_sim_robots FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));
CREATE POLICY alliance_sim_robots_member_update ON alliance_sim_robots FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY alliance_sim_robots_member_delete ON alliance_sim_robots FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON alliance_sim_robots TO vantage_app, vantage_worker;
