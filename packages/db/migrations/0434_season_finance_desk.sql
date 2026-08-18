-- Season finance desk: funding sources (school, fees, grants, sponsors, fundraisers)
-- and a purchase log for receipts/reimbursements. Rolls up with existing sponsor
-- contributions, grant awards, fundraiser proceeds, purchase requests, and season
-- costs. Never stores card/bank numbers. Org-scoped RLS.

CREATE TABLE finance_funding_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 2000 AND 3000),
  kind text NOT NULL CHECK (
    kind IN (
      'school',
      'student_fees',
      'grant',
      'sponsor',
      'fundraiser',
      'in_kind',
      'other'
    )
  ),
  name text NOT NULL,
  planned_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (planned_usd >= 0),
  received_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (received_usd >= 0),
  received_on date,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX finance_funding_sources_org_season_idx
  ON finance_funding_sources (org_id, season_year, kind);

CREATE TABLE finance_purchase_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 2000 AND 3000),
  purchased_on date NOT NULL,
  vendor text NOT NULL,
  item text NOT NULL,
  category_id uuid REFERENCES finance_categories(id) ON DELETE SET NULL,
  amount_usd numeric(12,2) NOT NULL CHECK (amount_usd >= 0),
  payment_method text NOT NULL DEFAULT 'other' CHECK (
    payment_method IN (
      'card',
      'cash',
      'check',
      'reimbursement',
      'purchase_order',
      'in_kind',
      'other'
    )
  ),
  receipt_url text,
  purchase_request_id uuid REFERENCES purchase_requests(id) ON DELETE SET NULL,
  reimbursed_on date,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_purchase_log_receipt_url_chk CHECK (
    receipt_url IS NULL OR receipt_url ~* '^https?://'
  )
);
CREATE INDEX finance_purchase_log_org_season_idx
  ON finance_purchase_log (org_id, season_year, purchased_on DESC);

ALTER TABLE finance_funding_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_purchase_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY finance_funding_sources_member_read ON finance_funding_sources
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY finance_funding_sources_admin_insert ON finance_funding_sources
  FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND created_by = current_app_user_id()
  );
CREATE POLICY finance_funding_sources_admin_update ON finance_funding_sources
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY finance_funding_sources_admin_delete ON finance_funding_sources
  FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY finance_purchase_log_member_read ON finance_purchase_log
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY finance_purchase_log_member_insert ON finance_purchase_log
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY finance_purchase_log_self_update ON finance_purchase_log
  FOR UPDATE TO vantage_app
  USING (created_by = current_app_user_id())
  WITH CHECK (created_by = current_app_user_id());
CREATE POLICY finance_purchase_log_self_delete ON finance_purchase_log
  FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id());
CREATE POLICY finance_purchase_log_admin_write ON finance_purchase_log
  FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON finance_funding_sources, finance_purchase_log
  TO vantage_app, vantage_worker;
