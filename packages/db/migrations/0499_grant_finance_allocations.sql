-- Grant ↔ finance linkage. Grant reports may attribute ONLY these allocation rows —
-- never season-wide finance_transactions totals. Distinct from 0282 grant_report_reports
-- (generated artifacts) and 0035 finance_transactions (the ledger spine, which has no
-- grant column).

CREATE TABLE grant_finance_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_application_id uuid NOT NULL REFERENCES grant_applications(id) ON DELETE CASCADE,
  finance_transaction_id uuid NOT NULL REFERENCES finance_transactions(id) ON DELETE CASCADE,
  amount_usd numeric(12,2) NOT NULL CHECK (amount_usd > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, grant_application_id, finance_transaction_id)
);
CREATE INDEX grant_finance_allocations_org_grant_idx
  ON grant_finance_allocations(org_id, grant_application_id);
CREATE INDEX grant_finance_allocations_org_txn_idx
  ON grant_finance_allocations(org_id, finance_transaction_id);

ALTER TABLE grant_finance_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY grant_finance_allocations_member_read ON grant_finance_allocations FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY grant_finance_allocations_member_insert ON grant_finance_allocations FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY grant_finance_allocations_member_update ON grant_finance_allocations FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY grant_finance_allocations_member_delete ON grant_finance_allocations FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON grant_finance_allocations TO vantage_app, vantage_worker;

COMMENT ON TABLE grant_finance_allocations IS
  'Explicit grant-to-ledger allocations. Grant reports attribute only these rows; untagged season expenses never count.';
