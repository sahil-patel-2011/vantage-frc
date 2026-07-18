-- Grant writing engine: org-scoped narrative drafts from guided fields
-- (need, impact, budget, timeline) with provenance. THIS org only via RLS.

CREATE TABLE IF NOT EXISTS grant_writing_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_application_id uuid REFERENCES grant_applications(id) ON DELETE SET NULL,
  season_year integer NOT NULL CHECK (season_year BETWEEN 2000 AND 3000),
  template_key text NOT NULL
    CHECK (template_key IN (
      'community_foundation',
      'stem_education',
      'equipment_materials',
      'travel_competition',
      'general_narrative'
    )),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  funder_name text,
  ask_amount_usd numeric(12,2) CHECK (ask_amount_usd IS NULL OR ask_amount_usd >= 0),
  need_text text NOT NULL DEFAULT '',
  impact_text text NOT NULL DEFAULT '',
  budget_text text NOT NULL DEFAULT '',
  timeline_text text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'submitted', 'archived')),
  source text NOT NULL DEFAULT 'template'
    CHECK (source IN ('template', 'manual', 'ai')),
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS grant_writing_drafts_org_season_idx
  ON grant_writing_drafts(org_id, season_year, updated_at DESC);
CREATE INDEX IF NOT EXISTS grant_writing_drafts_org_status_idx
  ON grant_writing_drafts(org_id, status);

ALTER TABLE grant_writing_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grant_writing_drafts_member_read ON grant_writing_drafts;
DROP POLICY IF EXISTS grant_writing_drafts_member_insert ON grant_writing_drafts;
DROP POLICY IF EXISTS grant_writing_drafts_member_update ON grant_writing_drafts;
DROP POLICY IF EXISTS grant_writing_drafts_member_delete ON grant_writing_drafts;

CREATE POLICY grant_writing_drafts_member_read ON grant_writing_drafts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY grant_writing_drafts_member_insert ON grant_writing_drafts FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY grant_writing_drafts_member_update ON grant_writing_drafts FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY grant_writing_drafts_member_delete ON grant_writing_drafts FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON grant_writing_drafts TO vantage_app, vantage_worker;
