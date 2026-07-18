-- Shooter / launcher lookup table: calibrated distance -> (RPM, hood angle)
-- points. Interpolation is done in the app. Unique per (org, season, table,
-- distance) so re-shooting a distance updates the point in place.

CREATE TABLE shooter_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  table_name text NOT NULL DEFAULT 'Shooter',
  distance_ft numeric(6, 2) NOT NULL CHECK (distance_ft > 0),
  rpm numeric(7, 1) CHECK (rpm IS NULL OR rpm >= 0),
  hood_angle numeric(6, 2) CHECK (hood_angle IS NULL OR hood_angle >= 0),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year, table_name, distance_ft)
);
CREATE INDEX shooter_points_org_season_idx ON shooter_points(org_id, season_year, table_name, distance_ft);

ALTER TABLE shooter_points ENABLE ROW LEVEL SECURITY;

-- Shooter tuning is collaborative: any member can record/update/remove points.
CREATE POLICY shooter_points_read ON shooter_points FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY shooter_points_insert ON shooter_points FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY shooter_points_update ON shooter_points FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY shooter_points_delete ON shooter_points FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON shooter_points TO vantage_app, vantage_worker;
