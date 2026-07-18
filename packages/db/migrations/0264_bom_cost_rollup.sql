-- BOM cost rollup: live bill-of-materials cost vs budget, sourced from CAD-exported or manually
-- logged BOM line items. Distinct from 0038 community impact and the existing weight/power budget
-- reconciler (0024-era weight_components/power_loads) — this tracks dollars, not mass or current.

CREATE TABLE bom_cost_rollup_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  part_name text NOT NULL,
  subsystem text NOT NULL DEFAULT 'Unassigned',
  category text NOT NULL DEFAULT 'purchased'
    CHECK (category IN ('purchased','raw_material','fastener','electronics','other')),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost_usd numeric(10,2) NOT NULL DEFAULT 0 CHECK (unit_cost_usd >= 0),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','cad_import')),
  cad_reference text,
  season_year integer NOT NULL,
  notes text,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bom_cost_rollup_line_items_org_season_idx
  ON bom_cost_rollup_line_items(org_id, season_year, created_at DESC);

ALTER TABLE bom_cost_rollup_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY bom_cost_rollup_line_items_member_read ON bom_cost_rollup_line_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY bom_cost_rollup_line_items_member_insert ON bom_cost_rollup_line_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY bom_cost_rollup_line_items_member_update ON bom_cost_rollup_line_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY bom_cost_rollup_line_items_member_delete ON bom_cost_rollup_line_items FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bom_cost_rollup_line_items TO vantage_app, vantage_worker;

CREATE TABLE bom_cost_rollup_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  budget_usd numeric(10,2) NOT NULL DEFAULT 0 CHECK (budget_usd >= 0),
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year)
);

ALTER TABLE bom_cost_rollup_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY bom_cost_rollup_budgets_member_read ON bom_cost_rollup_budgets FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY bom_cost_rollup_budgets_member_insert ON bom_cost_rollup_budgets FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND updated_by = current_app_user_id());
CREATE POLICY bom_cost_rollup_budgets_member_update ON bom_cost_rollup_budgets FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY bom_cost_rollup_budgets_member_delete ON bom_cost_rollup_budgets FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bom_cost_rollup_budgets TO vantage_app, vantage_worker;
