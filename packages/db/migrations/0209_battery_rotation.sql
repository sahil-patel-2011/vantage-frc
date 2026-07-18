-- Battery rotation & charge planner: which battery goes in which match, driven by internal-resistance
-- (IR) trend vs. match cadence and available charge time. Distinct from 0048 battery_packs/battery_logs
-- (the general fleet-health canonical store) -- this is the competition-day rotation/scheduling surface,
-- with its own registry so it degrades cleanly to setup_required with no cross-feature coupling.

CREATE TABLE battery_rotation_batteries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  serial_number text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'charging', 'short_pack', 'retired')),
  purchased_on date,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX battery_rotation_batteries_org_idx ON battery_rotation_batteries(org_id, status);

CREATE TABLE battery_rotation_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  battery_id uuid NOT NULL REFERENCES battery_rotation_batteries(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  internal_resistance_mohm numeric(6, 2) NOT NULL CHECK (internal_resistance_mohm >= 0),
  voltage numeric(5, 2),
  cycle_count integer CHECK (cycle_count IS NULL OR cycle_count >= 0),
  notes text,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX battery_rotation_readings_battery_idx
  ON battery_rotation_readings(battery_id, recorded_at DESC);
CREATE INDEX battery_rotation_readings_org_idx ON battery_rotation_readings(org_id, recorded_at DESC);

CREATE TABLE battery_rotation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  battery_id uuid NOT NULL REFERENCES battery_rotation_batteries(id) ON DELETE CASCADE,
  match_label text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  charge_minutes_available integer NOT NULL DEFAULT 0 CHECK (charge_minutes_available >= 0),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX battery_rotation_assignments_org_idx
  ON battery_rotation_assignments(org_id, scheduled_at);
CREATE INDEX battery_rotation_assignments_battery_idx
  ON battery_rotation_assignments(battery_id, scheduled_at);

ALTER TABLE battery_rotation_batteries ENABLE ROW LEVEL SECURITY;
ALTER TABLE battery_rotation_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE battery_rotation_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY battery_rotation_batteries_member_read ON battery_rotation_batteries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY battery_rotation_batteries_member_insert ON battery_rotation_batteries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY battery_rotation_batteries_member_update ON battery_rotation_batteries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY battery_rotation_batteries_member_delete ON battery_rotation_batteries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY battery_rotation_readings_member_read ON battery_rotation_readings FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY battery_rotation_readings_member_insert ON battery_rotation_readings FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY battery_rotation_readings_member_update ON battery_rotation_readings FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY battery_rotation_readings_member_delete ON battery_rotation_readings FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY battery_rotation_assignments_member_read ON battery_rotation_assignments FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY battery_rotation_assignments_member_insert ON battery_rotation_assignments FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY battery_rotation_assignments_member_update ON battery_rotation_assignments FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY battery_rotation_assignments_member_delete ON battery_rotation_assignments FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON battery_rotation_batteries TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON battery_rotation_readings TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON battery_rotation_assignments TO vantage_app, vantage_worker;
