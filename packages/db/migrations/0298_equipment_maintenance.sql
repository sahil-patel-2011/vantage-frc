-- Equipment maintenance: shop tool inventory (drill press, mill, lathe, 3D printers, saws, ...)
-- with a recurring maintenance interval, plus the log of maintenance actually performed. Distinct
-- from `spare_parts`/inventory (consumable stock) — this tracks upkeep of durable shop equipment.

CREATE TABLE equipment_maintenance_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('cnc','mill','lathe','drill_press','saw','printer_3d','laser','welder','hand_tool','safety','other')),
  location text,
  interval_days integer CHECK (interval_days IS NULL OR interval_days > 0),
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX equipment_maintenance_assets_org_idx ON equipment_maintenance_assets(org_id, active, name);

ALTER TABLE equipment_maintenance_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY equipment_maintenance_assets_member_read ON equipment_maintenance_assets FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY equipment_maintenance_assets_member_insert ON equipment_maintenance_assets FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY equipment_maintenance_assets_member_update ON equipment_maintenance_assets FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY equipment_maintenance_assets_member_delete ON equipment_maintenance_assets FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON equipment_maintenance_assets TO vantage_app, vantage_worker;

CREATE TABLE equipment_maintenance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES equipment_maintenance_assets(id) ON DELETE CASCADE,
  performed_on date NOT NULL,
  action text NOT NULL DEFAULT 'routine'
    CHECK (action IN ('routine','repair','inspection','calibration','cleaning','other')),
  minutes_spent integer NOT NULL DEFAULT 0 CHECK (minutes_spent >= 0),
  notes text,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX equipment_maintenance_logs_org_asset_idx
  ON equipment_maintenance_logs(org_id, asset_id, performed_on DESC);

ALTER TABLE equipment_maintenance_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY equipment_maintenance_logs_member_read ON equipment_maintenance_logs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY equipment_maintenance_logs_member_insert ON equipment_maintenance_logs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY equipment_maintenance_logs_member_update ON equipment_maintenance_logs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY equipment_maintenance_logs_member_delete ON equipment_maintenance_logs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON equipment_maintenance_logs TO vantage_app, vantage_worker;
