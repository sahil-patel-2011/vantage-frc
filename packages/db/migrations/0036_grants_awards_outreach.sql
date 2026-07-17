CREATE TYPE grant_status AS ENUM ('identified', 'drafting', 'in_review', 'submitted', 'awarded', 'declined');
CREATE TYPE grant_item_kind AS ENUM ('question', 'essay', 'attachment');
CREATE TYPE award_status AS ENUM ('planned', 'drafting', 'in_review', 'submitted', 'finalist', 'won', 'not_selected');
CREATE TYPE award_item_kind AS ENUM ('essay', 'task', 'question');
CREATE TYPE outreach_kind AS ENUM ('thank_you', 'renewal_ask', 'new_prospect_intro', 'grant_followup', 'custom');
CREATE TYPE outreach_status AS ENUM ('draft', 'sent');

CREATE TABLE grant_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  funder text,
  description text,
  amount_min_usd numeric(12,2) CHECK(amount_min_usd IS NULL OR amount_min_usd >= 0),
  amount_max_usd numeric(12,2) CHECK(amount_max_usd IS NULL OR amount_max_usd >= 0),
  deadline date,
  eligibility_notes text,
  application_url text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grant_opportunities_org_deadline_idx ON grant_opportunities(org_id, deadline);

CREATE TABLE grant_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_opportunity_id uuid REFERENCES grant_opportunities(id) ON DELETE SET NULL,
  season_year integer NOT NULL,
  status grant_status NOT NULL DEFAULT 'identified',
  amount_requested_usd numeric(12,2) CHECK(amount_requested_usd IS NULL OR amount_requested_usd >= 0),
  amount_awarded_usd numeric(12,2) CHECK(amount_awarded_usd IS NULL OR amount_awarded_usd >= 0),
  owner_user_id uuid REFERENCES users(id),
  submitted_at timestamptz,
  decision_at timestamptz,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grant_applications_org_season_status_idx ON grant_applications(org_id, season_year, status);

CREATE TABLE grant_application_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES grant_applications(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind grant_item_kind NOT NULL,
  prompt text,
  content text,
  char_limit integer,
  done boolean NOT NULL DEFAULT false,
  assignee_user_id uuid REFERENCES users(id),
  due_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grant_application_items_application_idx ON grant_application_items(application_id, sort_order);

CREATE TABLE award_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  event_key text,
  award_type text NOT NULL,
  title text,
  status award_status NOT NULL DEFAULT 'planned',
  priority text NOT NULL DEFAULT 'normal',
  deadline date,
  owner_user_id uuid REFERENCES users(id),
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX award_submissions_org_season_idx ON award_submissions(org_id, season_year);

CREATE TABLE award_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES award_submissions(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind award_item_kind NOT NULL,
  prompt text,
  content text,
  char_limit integer,
  done boolean NOT NULL DEFAULT false,
  assignee_user_id uuid REFERENCES users(id),
  due_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX award_items_submission_idx ON award_items(submission_id, sort_order);

CREATE TABLE outreach_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sponsor_id uuid REFERENCES sponsors(id) ON DELETE CASCADE,
  grant_application_id uuid REFERENCES grant_applications(id) ON DELETE CASCADE,
  kind outreach_kind NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status outreach_status NOT NULL DEFAULT 'draft',
  generated_by text NOT NULL DEFAULT 'template',
  sent_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outreach_messages_org_sponsor_idx ON outreach_messages(org_id, sponsor_id);

ALTER TABLE grant_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_application_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY grant_opportunities_member_read ON grant_opportunities FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY grant_opportunities_admin_write ON grant_opportunities FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));

CREATE POLICY grant_applications_member_read ON grant_applications FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY grant_applications_admin_write ON grant_applications FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));

CREATE POLICY grant_application_items_member_read ON grant_application_items FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY grant_application_items_admin_write ON grant_application_items FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));

CREATE POLICY award_submissions_member_read ON award_submissions FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY award_submissions_admin_write ON award_submissions FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));

CREATE POLICY award_items_member_read ON award_items FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY award_items_admin_write ON award_items FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));

CREATE POLICY outreach_messages_member_read ON outreach_messages FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY outreach_messages_admin_write ON outreach_messages FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND created_by=current_app_user_id());

GRANT SELECT,INSERT,UPDATE,DELETE ON grant_opportunities,grant_applications,grant_application_items,
 award_submissions,award_items,outreach_messages TO vantage_app;
