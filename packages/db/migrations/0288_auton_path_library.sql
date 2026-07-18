-- Autonomous path library: named auton paths (starting position, description, game pieces)
-- plus the individual runs logged against each path (success/partial/fail + context), so a
-- per-path success rate can be computed from real run history.

CREATE TABLE auton_path_library_paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_position text NOT NULL DEFAULT 'other'
    CHECK (start_position IN ('left','center','right','other')),
  description text,
  game_pieces integer NOT NULL DEFAULT 0 CHECK (game_pieces >= 0),
  season_year integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auton_path_library_paths_org_season_idx
  ON auton_path_library_paths(org_id, season_year, created_at DESC);

ALTER TABLE auton_path_library_paths ENABLE ROW LEVEL SECURITY;

CREATE POLICY auton_path_library_paths_member_read ON auton_path_library_paths FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY auton_path_library_paths_member_insert ON auton_path_library_paths FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY auton_path_library_paths_member_update ON auton_path_library_paths FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY auton_path_library_paths_member_delete ON auton_path_library_paths FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON auton_path_library_paths TO vantage_app, vantage_worker;

CREATE TABLE auton_path_library_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  path_id uuid NOT NULL REFERENCES auton_path_library_paths(id) ON DELETE CASCADE,
  outcome text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success','partial','fail')),
  occurred_on date NOT NULL,
  event_label text,
  match_label text,
  notes text,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auton_path_library_runs_org_path_idx
  ON auton_path_library_runs(org_id, path_id, occurred_on DESC);

ALTER TABLE auton_path_library_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY auton_path_library_runs_member_read ON auton_path_library_runs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY auton_path_library_runs_member_insert ON auton_path_library_runs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY auton_path_library_runs_member_update ON auton_path_library_runs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY auton_path_library_runs_member_delete ON auton_path_library_runs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON auton_path_library_runs TO vantage_app, vantage_worker;
