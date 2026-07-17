-- Unify the Team Business Portal with the canonical finance, sponsor, grant,
-- award, and outreach tables introduced in 0035-0036. This migration only adds
-- cross-module fields that the command center needs; it does not create a second ledger.

CREATE TABLE finance_season_settings (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 2000 AND 3000),
  operating_budget_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (operating_budget_usd >= 0),
  fundraising_goal_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (fundraising_goal_usd >= 0),
  notes text,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, season_year)
);

ALTER TABLE purchase_requests
  ADD COLUMN shipping_cost_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (shipping_cost_usd >= 0),
  ADD COLUMN needed_by date;

ALTER TABLE sponsors
  ADD COLUMN relationship_owner text,
  ADD COLUMN next_follow_up_on date;

ALTER TABLE sponsor_interactions
  ADD COLUMN next_step text,
  ADD COLUMN next_follow_up_on date;

ALTER TABLE sponsor_prospects
  ADD COLUMN fit_score integer NOT NULL DEFAULT 0 CHECK (fit_score BETWEEN 0 AND 100),
  ADD COLUMN source_query text;

ALTER TABLE grant_applications
  ADD COLUMN owner_name text;

ALTER TABLE award_submissions
  ADD COLUMN event_name text,
  ADD COLUMN award_level text,
  ADD COLUMN source_url text;

ALTER TABLE outreach_messages
  ADD COLUMN document_type text
    CHECK (document_type IS NULL OR document_type IN ('sponsor_email','grant_narrative','thank_you','renewal')),
  ADD COLUMN audience text,
  ADD COLUMN goal text,
  ADD COLUMN evidence jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE team_business_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_business_audit_org_date_idx ON team_business_audit_events(org_id, created_at DESC);

CREATE INDEX sponsor_prospects_org_website_idx ON sponsor_prospects(org_id, website)
  WHERE website IS NOT NULL;

ALTER TABLE finance_season_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_business_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY finance_season_settings_member_read ON finance_season_settings FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY finance_season_settings_admin_write ON finance_season_settings FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND updated_by = current_app_user_id());

CREATE POLICY team_business_audit_member_read ON team_business_audit_events FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY team_business_audit_actor_insert ON team_business_audit_events FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND actor_user_id = current_app_user_id());

-- Students can contribute research, application drafts, award evidence, and
-- sponsor touchpoints. Only owners/admins can approve or post money.
CREATE POLICY sponsor_interactions_member_insert ON sponsor_interactions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY sponsor_prospects_member_insert ON sponsor_prospects FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));
CREATE POLICY sponsor_prospects_member_update ON sponsor_prospects FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY grant_opportunities_member_insert ON grant_opportunities FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY grant_applications_member_insert ON grant_applications FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND status <> 'awarded');
CREATE POLICY grant_applications_member_progress ON grant_applications FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND status <> 'awarded')
  WITH CHECK (is_org_member(org_id) AND status <> 'awarded');
CREATE POLICY grant_application_items_member_insert ON grant_application_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));
CREATE POLICY award_submissions_member_insert ON award_submissions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));
CREATE POLICY outreach_messages_member_insert ON outreach_messages FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY outreach_messages_owner_update ON outreach_messages FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND created_by = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON finance_season_settings, team_business_audit_events
  TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON finance_categories, finance_budget_plans, purchase_requests,
  finance_transactions, sponsors, sponsor_contacts, sponsor_contributions, sponsor_interactions,
  sponsor_prospects, grant_opportunities, grant_applications, grant_application_items,
  award_submissions, outreach_messages TO vantage_worker;
