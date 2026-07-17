-- Autonomous routine library. The team's catalog of auto programs: which start
-- position each runs from, its status (concept -> coding -> tested ->
-- competition-ready), estimated points, and path notes. Readiness/coverage is
-- computed in the app from these rows.

CREATE TABLE auto_routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  name text NOT NULL,
  start_position text NOT NULL DEFAULT 'center' CHECK (start_position IN ('left', 'center', 'right', 'other')),
  status text NOT NULL DEFAULT 'concept' CHECK (status IN ('concept', 'coding', 'tested', 'competition_ready', 'retired')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  estimated_points integer CHECK (estimated_points IS NULL OR estimated_points >= 0),
  description text NOT NULL DEFAULT '',
  path_notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auto_routines_org_season_idx ON auto_routines(org_id, season_year, status);

ALTER TABLE auto_routines ENABLE ROW LEVEL SECURITY;

-- The whole team maintains the auto library; deletes limited to author or admin.
CREATE POLICY auto_routines_read ON auto_routines FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY auto_routines_insert ON auto_routines FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY auto_routines_update ON auto_routines FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY auto_routines_delete ON auto_routines FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON auto_routines TO vantage_app, vantage_worker;
