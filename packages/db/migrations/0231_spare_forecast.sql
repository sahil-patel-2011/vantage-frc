-- Spare-parts failure-forecast: predict which spares will be exhausted before season end
-- (FMEA repeat rate x inventory bins x consumption cadence) and let a team draft/track a
-- purchase request from that forecast. Forecasts themselves are computed live from the
-- existing fmea_failures / inventory_items tables (see compute-spare-forecast.ts); this
-- migration only persists the purchase-request drafts a team chooses to create and act on.

CREATE TABLE spare_forecast_purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'ordered', 'dismissed')),
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_estimated_cost numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total_estimated_cost >= 0),
  rationale text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX spare_forecast_purchase_requests_org_season_idx
  ON spare_forecast_purchase_requests(org_id, season_year, created_at DESC);

ALTER TABLE spare_forecast_purchase_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY spare_forecast_purchase_requests_member_read ON spare_forecast_purchase_requests
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY spare_forecast_purchase_requests_member_insert ON spare_forecast_purchase_requests
  FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY spare_forecast_purchase_requests_member_update ON spare_forecast_purchase_requests
  FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY spare_forecast_purchase_requests_member_delete ON spare_forecast_purchase_requests
  FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON spare_forecast_purchase_requests TO vantage_app, vantage_worker;
