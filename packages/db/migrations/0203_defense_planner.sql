-- Defensive matchup planner: for the next opponent, weigh OUR mass + drivetrain against
-- THEIR scouted cycle path (cycle time, points/cycle) to compute whether/whom to play
-- defense. Two tables: our own per-season robot profile, and per-opponent matchup rows
-- that store the scouted inputs plus the last computed recommendation.

CREATE TABLE defense_planner_robot_profiles (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  mass_lbs numeric(7, 2) NOT NULL CHECK (mass_lbs > 0),
  drivetrain_type text NOT NULL DEFAULT 'west_coast'
    CHECK (drivetrain_type IN ('west_coast', 'swerve', 'mecanum', 'tank', 'other')),
  top_speed_fps numeric(6, 2) CHECK (top_speed_fps IS NULL OR top_speed_fps > 0),
  notes text NOT NULL DEFAULT '',
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, season_year)
);

CREATE TABLE defense_planner_matchups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  opponent_team_number integer NOT NULL CHECK (opponent_team_number > 0),
  opponent_team_name text NOT NULL DEFAULT '',
  event_key text,
  opponent_mass_lbs numeric(7, 2) NOT NULL CHECK (opponent_mass_lbs > 0),
  opponent_drivetrain_type text NOT NULL DEFAULT 'west_coast'
    CHECK (opponent_drivetrain_type IN ('west_coast', 'swerve', 'mecanum', 'tank', 'other')),
  opponent_cycle_time_sec numeric(6, 2) NOT NULL CHECK (opponent_cycle_time_sec > 0),
  opponent_cycle_path text NOT NULL DEFAULT '',
  opponent_avg_points_per_cycle numeric(6, 2) NOT NULL CHECK (opponent_avg_points_per_cycle >= 0),
  notes text NOT NULL DEFAULT '',
  recommendation text NOT NULL DEFAULT 'situational'
    CHECK (recommendation IN ('play_defense', 'stay_offense', 'situational')),
  assigned_defender text NOT NULL DEFAULT 'situational'
    CHECK (assigned_defender IN ('us', 'none', 'situational')),
  confidence numeric(4, 3) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  rationale text NOT NULL DEFAULT '',
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX defense_planner_matchups_org_season_idx
  ON defense_planner_matchups(org_id, season_year, opponent_team_number);

ALTER TABLE defense_planner_robot_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE defense_planner_matchups ENABLE ROW LEVEL SECURITY;

CREATE POLICY defense_planner_robot_profiles_member_read ON defense_planner_robot_profiles
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY defense_planner_robot_profiles_member_insert ON defense_planner_robot_profiles
  FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND updated_by = current_app_user_id());
CREATE POLICY defense_planner_robot_profiles_member_update ON defense_planner_robot_profiles
  FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY defense_planner_robot_profiles_member_delete ON defense_planner_robot_profiles
  FOR DELETE TO vantage_app USING (is_org_member(org_id));

CREATE POLICY defense_planner_matchups_member_read ON defense_planner_matchups
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY defense_planner_matchups_member_insert ON defense_planner_matchups
  FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY defense_planner_matchups_member_update ON defense_planner_matchups
  FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY defense_planner_matchups_member_delete ON defense_planner_matchups
  FOR DELETE TO vantage_app USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON defense_planner_robot_profiles, defense_planner_matchups
  TO vantage_app, vantage_worker;
