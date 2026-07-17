-- Battery fleet tracking. FRC teams run a rotation of 12V SLA packs and must
-- know each pack's wear (internal resistance, cycles, age) to pick a healthy
-- one for every match and retire packs before they brown out the robot.
-- battery_packs is the fleet; battery_logs is an append-only event/measurement
-- stream (charges, match/practice discharges, Battery Beak resistance tests).

CREATE TABLE battery_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  brand text,
  nominal_ah numeric(6, 2) CHECK (nominal_ah IS NULL OR nominal_ah > 0),
  purchase_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'quarantine', 'retired')),
  assignment text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, label)
);
CREATE INDEX battery_packs_org_idx ON battery_packs(org_id, status);

CREATE TABLE battery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  battery_id uuid NOT NULL REFERENCES battery_packs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('charge', 'storage_charge', 'match', 'practice', 'resistance_test', 'note', 'retire', 'return_to_service')),
  resting_voltage numeric(5, 2) CHECK (resting_voltage IS NULL OR resting_voltage >= 0),
  internal_resistance_mohm numeric(6, 2) CHECK (internal_resistance_mohm IS NULL OR internal_resistance_mohm >= 0),
  match_key text,
  note text NOT NULL DEFAULT '',
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX battery_logs_battery_idx ON battery_logs(battery_id, created_at DESC);
CREATE INDEX battery_logs_org_idx ON battery_logs(org_id, created_at DESC);

ALTER TABLE battery_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE battery_logs ENABLE ROW LEVEL SECURITY;

-- The whole team maintains the battery fleet; destructive pack deletes are
-- limited to the row creator or an owner/admin. The log is insert-only.
CREATE POLICY battery_packs_read ON battery_packs FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY battery_packs_insert ON battery_packs FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY battery_packs_update ON battery_packs FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY battery_packs_delete ON battery_packs FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY battery_logs_read ON battery_logs FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY battery_logs_insert ON battery_logs FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON battery_packs, battery_logs TO vantage_app, vantage_worker;
