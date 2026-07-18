-- Robot power / current budget. One row per electrical load with its expected
-- typical/peak current and branch breaker. Totals and failure-mode flags
-- (breaker trip, brownout) are computed in the app.

CREATE TABLE power_loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  name text NOT NULL,
  subsystem text NOT NULL DEFAULT '',
  motor_count integer CHECK (motor_count IS NULL OR motor_count >= 0),
  typical_amps numeric(7, 2) CHECK (typical_amps IS NULL OR typical_amps >= 0),
  peak_amps numeric(7, 2) CHECK (peak_amps IS NULL OR peak_amps >= 0),
  breaker_amps numeric(7, 2) CHECK (breaker_amps IS NULL OR breaker_amps >= 0),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX power_loads_org_season_idx ON power_loads(org_id, season_year, subsystem);

ALTER TABLE power_loads ENABLE ROW LEVEL SECURITY;

-- The whole team maintains the power budget; deletes limited to author or admin.
CREATE POLICY power_loads_read ON power_loads FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY power_loads_insert ON power_loads FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY power_loads_update ON power_loads FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY power_loads_delete ON power_loads FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON power_loads TO vantage_app, vantage_worker;
