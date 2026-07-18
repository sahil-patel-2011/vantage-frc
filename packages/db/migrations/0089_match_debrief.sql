-- Our-robot match debrief (self-scouting). One row per one of the team's own
-- matches: result, points, mechanism health, and what worked / broke / to fix.
-- Distinct from scouting (other teams) and from match strategy planning.

CREATE TABLE match_debriefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  event_key text NOT NULL DEFAULT '',
  match_label text NOT NULL,
  alliance text NOT NULL DEFAULT 'unknown' CHECK (alliance IN ('red', 'blue', 'unknown')),
  result text NOT NULL DEFAULT 'unknown' CHECK (result IN ('win', 'loss', 'tie', 'unknown')),
  points_scored integer CHECK (points_scored IS NULL OR points_scored >= 0),
  cycle_count integer CHECK (cycle_count IS NULL OR cycle_count >= 0),
  drivetrain_ok boolean NOT NULL DEFAULT true,
  mechanisms_ok boolean NOT NULL DEFAULT true,
  auto_ok boolean NOT NULL DEFAULT true,
  what_worked text NOT NULL DEFAULT '',
  what_broke text NOT NULL DEFAULT '',
  action_items text NOT NULL DEFAULT '',
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX match_debriefs_org_season_idx ON match_debriefs(org_id, season_year, created_at DESC);

ALTER TABLE match_debriefs ENABLE ROW LEVEL SECURITY;

-- The whole team keeps the match log; deletes limited to the author or an admin.
CREATE POLICY match_debriefs_read ON match_debriefs FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY match_debriefs_insert ON match_debriefs FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY match_debriefs_update ON match_debriefs FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY match_debriefs_delete ON match_debriefs FOR DELETE TO vantage_app USING (logged_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON match_debriefs TO vantage_app, vantage_worker;
