-- Robot wiring / CAN-bus map: one row per electrical device with its CAN ID,
-- CAN bus, power-distribution port, and subsystem. Conflict detection (duplicate
-- CAN IDs, shared power ports) is computed in the app from these rows.
-- device_type is validated in the app against a known list (kept flexible in the
-- DB so new controller types don't require a migration).

CREATE TABLE robot_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  name text NOT NULL,
  device_type text NOT NULL DEFAULT 'other',
  can_id integer CHECK (can_id IS NULL OR (can_id >= 0 AND can_id <= 62)),
  can_bus text NOT NULL DEFAULT 'rio' CHECK (can_bus IN ('rio', 'canivore')),
  pdh_port integer CHECK (pdh_port IS NULL OR (pdh_port >= 0 AND pdh_port <= 23)),
  breaker_amp integer CHECK (breaker_amp IS NULL OR (breaker_amp >= 0 AND breaker_amp <= 60)),
  subsystem text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX robot_devices_org_season_idx ON robot_devices(org_id, season_year, subsystem);

ALTER TABLE robot_devices ENABLE ROW LEVEL SECURITY;

-- The whole team maintains the wiring map; deletes limited to author or admin.
CREATE POLICY robot_devices_read ON robot_devices FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY robot_devices_insert ON robot_devices FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY robot_devices_update ON robot_devices FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY robot_devices_delete ON robot_devices FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON robot_devices TO vantage_app, vantage_worker;
