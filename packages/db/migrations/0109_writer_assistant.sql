-- Grant & Sponsorship Writing Assistant: a reusable team profile + a library of drafted grant
-- answers and sponsor emails composed from that profile. The composition is template-based and
-- local (source='template'); the schema is ready for LLM-backed drafts (source='ai') later.
-- Org-scoped, collaborative, per-org RLS.

CREATE TABLE writer_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  team_name text NOT NULL DEFAULT 'Our team',
  team_number integer,
  region text,
  mission text,
  achievements jsonb NOT NULL DEFAULT '[]',
  funding_need text,
  funding_ask_usd numeric(12,2) CHECK (funding_ask_usd IS NULL OR funding_ask_usd >= 0),
  tone text NOT NULL DEFAULT 'warm' CHECK (tone IN ('warm','professional','concise')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year)
);

CREATE TABLE writer_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('grant','cold_intro','sponsorship_ask','renewal','thank_you','grant_followup')),
  title text NOT NULL,
  target_name text,
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final','sent')),
  source text NOT NULL DEFAULT 'template',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX writer_drafts_org_season_idx ON writer_drafts(org_id, season_year, created_at DESC);

ALTER TABLE writer_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE writer_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY writer_profile_member_read ON writer_profile FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY writer_profile_member_write ON writer_profile FOR ALL TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE POLICY writer_drafts_member_read ON writer_drafts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY writer_drafts_member_insert ON writer_drafts FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY writer_drafts_member_update ON writer_drafts FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY writer_drafts_member_delete ON writer_drafts FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON writer_profile, writer_drafts TO vantage_app, vantage_worker;
