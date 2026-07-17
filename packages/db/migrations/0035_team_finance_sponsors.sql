CREATE TYPE finance_txn_type AS ENUM ('income', 'expense');
CREATE TYPE finance_txn_source AS ENUM ('purchase_request', 'sponsor_contribution', 'manual', 'fundraiser', 'other');
CREATE TYPE purchase_request_status AS ENUM ('pending', 'approved', 'rejected', 'ordered', 'received', 'reimbursed');
CREATE TYPE sponsor_tier AS ENUM ('in_kind', 'bronze', 'silver', 'gold', 'platinum', 'custom');
CREATE TYPE sponsor_status AS ENUM ('prospect', 'active', 'lapsed', 'declined');
CREATE TYPE sponsor_contribution_type AS ENUM ('cash', 'in_kind', 'discount');
CREATE TYPE sponsor_interaction_type AS ENUM ('email', 'call', 'meeting', 'event_invite', 'thank_you', 'other');
CREATE TYPE sponsor_prospect_status AS ENUM ('suggested', 'reviewing', 'contacted', 'dismissed');

CREATE TABLE finance_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, season_year, name)
);

CREATE TABLE finance_budget_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id uuid NOT NULL UNIQUE REFERENCES finance_categories(id) ON DELETE CASCADE,
  monthly_limit_usd numeric(12,2) CHECK(monthly_limit_usd IS NULL OR monthly_limit_usd >= 0),
  total_limit_usd numeric(12,2) CHECK(total_limit_usd IS NULL OR total_limit_usd >= 0),
  notes text,
  set_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  website text,
  tier sponsor_tier NOT NULL DEFAULT 'custom',
  status sponsor_status NOT NULL DEFAULT 'prospect',
  industry text,
  city text,
  state_prov text,
  notes text,
  first_sponsored_season integer,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);
CREATE INDEX sponsors_org_status_idx ON sponsors(org_id, status);

CREATE TABLE sponsor_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  title text,
  email text,
  phone text,
  is_primary boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_contacts_sponsor_idx ON sponsor_contacts(sponsor_id);

CREATE TABLE sponsor_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  type sponsor_contribution_type NOT NULL,
  amount_usd numeric(12,2) CHECK(amount_usd IS NULL OR amount_usd >= 0),
  estimated_value_usd numeric(12,2) CHECK(estimated_value_usd IS NULL OR estimated_value_usd >= 0),
  description text,
  received_at timestamptz NOT NULL DEFAULT now(),
  thank_you_sent_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_contributions_sponsor_season_idx ON sponsor_contributions(sponsor_id, season_year);
CREATE INDEX sponsor_contributions_org_season_idx ON sponsor_contributions(org_id, season_year);

CREATE TABLE sponsor_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type sponsor_interaction_type NOT NULL,
  subject text,
  notes text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_interactions_sponsor_occurred_idx ON sponsor_interactions(sponsor_id, occurred_at);

CREATE TABLE sponsor_prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  website text,
  rationale text,
  source_urls jsonb NOT NULL DEFAULT '[]',
  status sponsor_prospect_status NOT NULL DEFAULT 'suggested',
  related_sponsor_id uuid REFERENCES sponsors(id) ON DELETE SET NULL,
  converted_sponsor_id uuid REFERENCES sponsors(id) ON DELETE SET NULL,
  suggested_by text NOT NULL DEFAULT 'heuristic_agent',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_prospects_org_status_idx ON sponsor_prospects(org_id, status);

CREATE TABLE purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  category_id uuid REFERENCES finance_categories(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  vendor text NOT NULL DEFAULT 'amazon',
  item_url text,
  quantity integer NOT NULL DEFAULT 1 CHECK(quantity > 0),
  unit_cost_usd numeric(12,2) NOT NULL CHECK(unit_cost_usd >= 0),
  total_cost_usd numeric(12,2) NOT NULL CHECK(total_cost_usd >= 0),
  justification text,
  status purchase_request_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_notes text,
  ordered_at timestamptz,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_requests_org_status_idx ON purchase_requests(org_id, status);
CREATE INDEX purchase_requests_org_season_idx ON purchase_requests(org_id, season_year);

CREATE TABLE finance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  type finance_txn_type NOT NULL,
  source finance_txn_source NOT NULL,
  amount_usd numeric(12,2) NOT NULL CHECK(amount_usd >= 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  category_id uuid REFERENCES finance_categories(id) ON DELETE SET NULL,
  purchase_request_id uuid REFERENCES purchase_requests(id) ON DELETE SET NULL,
  sponsor_contribution_id uuid REFERENCES sponsor_contributions(id) ON DELETE SET NULL,
  description text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX finance_transactions_org_occurred_idx ON finance_transactions(org_id, occurred_at);
CREATE INDEX finance_transactions_org_season_idx ON finance_transactions(org_id, season_year);

CREATE TABLE finance_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX finance_audit_log_org_created_idx ON finance_audit_log(org_id, created_at);

ALTER TABLE finance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_budget_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY finance_categories_member_read ON finance_categories FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY finance_categories_admin_write ON finance_categories FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));

CREATE POLICY finance_budget_plans_member_read ON finance_budget_plans FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY finance_budget_plans_admin_write ON finance_budget_plans FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND set_by=current_app_user_id());

CREATE POLICY sponsors_member_read ON sponsors FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY sponsors_admin_write ON sponsors FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));

CREATE POLICY sponsor_contacts_member_read ON sponsor_contacts FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY sponsor_contacts_admin_write ON sponsor_contacts FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));

CREATE POLICY sponsor_contributions_member_read ON sponsor_contributions FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY sponsor_contributions_admin_write ON sponsor_contributions FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));

CREATE POLICY sponsor_interactions_member_read ON sponsor_interactions FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY sponsor_interactions_admin_write ON sponsor_interactions FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));

CREATE POLICY sponsor_prospects_member_read ON sponsor_prospects FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY sponsor_prospects_admin_write ON sponsor_prospects FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));

CREATE POLICY purchase_requests_member_read ON purchase_requests FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY purchase_requests_member_insert ON purchase_requests FOR INSERT TO vantage_app
 WITH CHECK(is_org_member(org_id) AND requested_by=current_app_user_id());
CREATE POLICY purchase_requests_member_self_edit ON purchase_requests FOR UPDATE TO vantage_app
 USING(requested_by=current_app_user_id() AND status='pending')
 WITH CHECK(requested_by=current_app_user_id());
CREATE POLICY purchase_requests_admin_write ON purchase_requests FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));

CREATE POLICY finance_transactions_member_read ON finance_transactions FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY finance_transactions_admin_write ON finance_transactions FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND created_by=current_app_user_id());

CREATE POLICY finance_audit_log_member_read ON finance_audit_log FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY finance_audit_log_admin_insert ON finance_audit_log FOR INSERT TO vantage_app
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND actor_user_id=current_app_user_id());

GRANT SELECT,INSERT,UPDATE,DELETE ON finance_categories,finance_budget_plans,sponsors,sponsor_contacts,
 sponsor_contributions,sponsor_interactions,sponsor_prospects,purchase_requests,finance_transactions,
 finance_audit_log TO vantage_app;
