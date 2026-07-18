-- Battery health forecast: predicts end-of-life / retirement for a battery pack from its
-- cycle-count and internal-resistance (IR) reading history. Distinct from 0209 battery_rotation
-- (match-day rotation/charge scheduling) and 0048 battery_packs/battery_logs (general fleet log)
-- -- this is its own registry of batteries + readings so retirement forecasting degrades cleanly
-- to setup_required with no cross-feature coupling.

CREATE TABLE battery_health_forecast_batteries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  serial_number text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'retired')),
  put_in_service_on date,
  retired_on date,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX battery_health_forecast_batteries_org_idx
  ON battery_health_forecast_batteries(org_id, status);

CREATE TABLE battery_health_forecast_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  battery_id uuid NOT NULL REFERENCES battery_health_forecast_batteries(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  cycle_count integer NOT NULL CHECK (cycle_count >= 0),
  internal_resistance_mohm numeric(6, 2) NOT NULL CHECK (internal_resistance_mohm >= 0),
  voltage numeric(5, 2),
  notes text,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX battery_health_forecast_readings_battery_idx
  ON battery_health_forecast_readings(battery_id, recorded_at DESC);
CREATE INDEX battery_health_forecast_readings_org_idx
  ON battery_health_forecast_readings(org_id, recorded_at DESC);

ALTER TABLE battery_health_forecast_batteries ENABLE ROW LEVEL SECURITY;
ALTER TABLE battery_health_forecast_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY battery_health_forecast_batteries_member_read ON battery_health_forecast_batteries
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY battery_health_forecast_batteries_member_insert ON battery_health_forecast_batteries
  FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY battery_health_forecast_batteries_member_update ON battery_health_forecast_batteries
  FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY battery_health_forecast_batteries_member_delete ON battery_health_forecast_batteries
  FOR DELETE TO vantage_app USING (is_org_member(org_id));

CREATE POLICY battery_health_forecast_readings_member_read ON battery_health_forecast_readings
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY battery_health_forecast_readings_member_insert ON battery_health_forecast_readings
  FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY battery_health_forecast_readings_member_update ON battery_health_forecast_readings
  FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY battery_health_forecast_readings_member_delete ON battery_health_forecast_readings
  FOR DELETE TO vantage_app USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON battery_health_forecast_batteries TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON battery_health_forecast_readings TO vantage_app, vantage_worker;
