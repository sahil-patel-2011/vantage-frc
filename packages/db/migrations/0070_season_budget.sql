-- Season Costs & Budget: a team's REAL-WORLD season spend (FRC registration + event fees +
-- everything bought) tracked against one budget, plus an opt-in flag for the automated
-- finance assistant. Distinct from app AI/usage budgets (org_billing / api budgets) and from
-- the finance/purchase-request workflow. Org-scoped, collaborative, per-org RLS.

CREATE TABLE season_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  total_budget_usd numeric(12,2) CHECK (total_budget_usd IS NULL OR total_budget_usd >= 0),
  ai_assist_enabled boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year)
);

CREATE TABLE season_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('registration','event_fee','parts','materials','tools','travel','marketing','safety','field','other')),
  amount_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_usd >= 0),
  vendor text,
  incurred_on date NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','paid')),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX season_costs_org_season_idx ON season_costs(org_id, season_year, incurred_on DESC);

ALTER TABLE season_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_costs ENABLE ROW LEVEL SECURITY;

-- Any org member may read and manage the shared budget/costs; rows stamp the author.
CREATE POLICY season_budgets_member_read ON season_budgets FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY season_budgets_member_write ON season_budgets FOR ALL TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE POLICY season_costs_member_read ON season_costs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY season_costs_member_insert ON season_costs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY season_costs_member_update ON season_costs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY season_costs_member_delete ON season_costs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON season_budgets, season_costs TO vantage_app, vantage_worker;
