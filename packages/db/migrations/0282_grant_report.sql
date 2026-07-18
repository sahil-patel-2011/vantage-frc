-- Grant Report: post-grant impact report generator, grounded only in this org's own recorded
-- outreach (outreach_messages) and finance (finance_transactions) data for the awarded grant's
-- season. Distinct from 0036 grant_applications (the application/tracking record) — this stores
-- the generated report artifact once a grant has been awarded.

CREATE TABLE grant_report_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_application_id uuid NOT NULL REFERENCES grant_applications(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  amount_awarded_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_awarded_usd >= 0),
  total_spend_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_spend_usd >= 0),
  outreach_count integer NOT NULL DEFAULT 0 CHECK (outreach_count >= 0),
  outreach_by_kind jsonb NOT NULL DEFAULT '[]',
  spend_by_category jsonb NOT NULL DEFAULT '[]',
  sections jsonb NOT NULL DEFAULT '[]',
  narrative text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grant_report_reports_org_grant_idx ON grant_report_reports(org_id, grant_application_id, created_at DESC);

ALTER TABLE grant_report_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY grant_report_reports_member_read ON grant_report_reports FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY grant_report_reports_member_insert ON grant_report_reports FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY grant_report_reports_member_update ON grant_report_reports FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY grant_report_reports_member_delete ON grant_report_reports FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON grant_report_reports TO vantage_app, vantage_worker;
