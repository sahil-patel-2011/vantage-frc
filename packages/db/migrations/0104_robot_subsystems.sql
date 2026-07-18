-- Robot subsystem spec sheet: per-mechanism key specs (motor, count, gear
-- reduction, wheel diameter). Theoretical free speed is computed in the app.

CREATE TABLE robot_subsystems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('drivetrain', 'intake', 'shooter', 'arm', 'elevator', 'climber', 'turret', 'indexer', 'other')),
  motor_type text NOT NULL DEFAULT '',
  motor_count integer CHECK (motor_count IS NULL OR motor_count >= 0),
  gear_reduction numeric(8, 3) CHECK (gear_reduction IS NULL OR gear_reduction > 0),
  wheel_diameter_in numeric(6, 2) CHECK (wheel_diameter_in IS NULL OR wheel_diameter_in > 0),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX robot_subsystems_org_season_idx ON robot_subsystems(org_id, season_year, category);

ALTER TABLE robot_subsystems ENABLE ROW LEVEL SECURITY;

-- The whole team maintains the spec sheet; deletes limited to author or admin.
CREATE POLICY robot_subsystems_read ON robot_subsystems FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY robot_subsystems_insert ON robot_subsystems FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY robot_subsystems_update ON robot_subsystems FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY robot_subsystems_delete ON robot_subsystems FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON robot_subsystems TO vantage_app, vantage_worker;
