-- Matching Gift Multiplier Finder: household-employer contact records joined against a curated/
-- lookup dataset of employer matching-gift programs (ratios, gift caps, deadlines — seeded from
-- public matching-gift databases, refreshed periodically) to surface a matched-company list, plus
-- manual pledge-status tracking and org-owned AI-drafted HR request letters. No payment processing.

-- Household-employer contact records (parent/alumni/mentor/other) an org maintains for matching-gift
-- discovery. Distinct from 0271 alumni_network_profiles (mentor directory) — this only tracks the
-- employer field needed to look up a matching-gift program.
CREATE TABLE matching_gift_finder_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  relationship text NOT NULL DEFAULT 'parent'
    CHECK (relationship IN ('parent', 'alumni', 'mentor', 'other')),
  employer_name text,
  email text,
  notes text,
  added_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX matching_gift_finder_contacts_org_idx ON matching_gift_finder_contacts(org_id, employer_name);

ALTER TABLE matching_gift_finder_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY matching_gift_finder_contacts_member_read ON matching_gift_finder_contacts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY matching_gift_finder_contacts_member_insert ON matching_gift_finder_contacts FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND added_by = current_app_user_id());
CREATE POLICY matching_gift_finder_contacts_member_update ON matching_gift_finder_contacts FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY matching_gift_finder_contacts_member_delete ON matching_gift_finder_contacts FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON matching_gift_finder_contacts TO vantage_app, vantage_worker;

-- Curated/lookup employer matching-gift program dataset. `source = 'seed'` rows are copied in per-org
-- (compute layer) from a small in-code reference list of well-known public matching-gift programs the
-- first time an org opens the tool; `source = 'manual'` rows are entries an org adds/edits itself.
-- Kept org-scoped (not a shared global table) so every row stays inside the standard RLS/tenancy model.
CREATE TABLE matching_gift_finder_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employer_name text NOT NULL,
  match_ratio text NOT NULL DEFAULT '1:1',
  min_gift_usd numeric,
  max_gift_usd numeric,
  annual_deadline text,
  submission_url text,
  notes text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('seed', 'manual')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX matching_gift_finder_programs_org_employer_idx
  ON matching_gift_finder_programs(org_id, lower(employer_name));

ALTER TABLE matching_gift_finder_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY matching_gift_finder_programs_member_read ON matching_gift_finder_programs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY matching_gift_finder_programs_member_insert ON matching_gift_finder_programs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));
CREATE POLICY matching_gift_finder_programs_member_update ON matching_gift_finder_programs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY matching_gift_finder_programs_member_delete ON matching_gift_finder_programs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON matching_gift_finder_programs TO vantage_app, vantage_worker;

-- Manual pledge-status tracking per contact/program match.
CREATE TABLE matching_gift_finder_pledges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES matching_gift_finder_contacts(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES matching_gift_finder_programs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'identified'
    CHECK (status IN ('identified', 'requested', 'submitted', 'matched', 'denied')),
  pledge_amount_usd numeric,
  requested_on date,
  resolved_on date,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX matching_gift_finder_pledges_contact_program_idx
  ON matching_gift_finder_pledges(contact_id, program_id);
CREATE INDEX matching_gift_finder_pledges_org_idx ON matching_gift_finder_pledges(org_id, status);

ALTER TABLE matching_gift_finder_pledges ENABLE ROW LEVEL SECURITY;

CREATE POLICY matching_gift_finder_pledges_member_read ON matching_gift_finder_pledges FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY matching_gift_finder_pledges_member_insert ON matching_gift_finder_pledges FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY matching_gift_finder_pledges_member_update ON matching_gift_finder_pledges FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY matching_gift_finder_pledges_member_delete ON matching_gift_finder_pledges FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON matching_gift_finder_pledges TO vantage_app, vantage_worker;

-- Metered AI-drafted HR matching-gift request emails/letters, one per contact/program request.
CREATE TABLE matching_gift_finder_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES matching_gift_finder_contacts(id) ON DELETE CASCADE,
  program_id uuid REFERENCES matching_gift_finder_programs(id) ON DELETE SET NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX matching_gift_finder_drafts_org_idx ON matching_gift_finder_drafts(org_id, contact_id, created_at DESC);

ALTER TABLE matching_gift_finder_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY matching_gift_finder_drafts_member_read ON matching_gift_finder_drafts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY matching_gift_finder_drafts_member_insert ON matching_gift_finder_drafts FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY matching_gift_finder_drafts_member_update ON matching_gift_finder_drafts FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY matching_gift_finder_drafts_member_delete ON matching_gift_finder_drafts FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON matching_gift_finder_drafts TO vantage_app, vantage_worker;
