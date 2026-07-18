-- FIRST Impact essay drafts: essays generated strictly from this org's logged outreach
-- activities (impact_activities), build/outreach hours (hour_logs), sponsors, and team
-- events (attendance_events) — every stored draft carries the citation list of real record
-- ids it was grounded in. Distinct from 0038 `impact_activities` (the raw activity log this
-- feature reads from, never writes to).

CREATE TABLE impact_essay_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 1992 AND 3000),
  award text NOT NULL CHECK (award IN ('impact', 'engineering_inspiration')),
  prompt text NOT NULL,
  essay_text text NOT NULL,
  word_count integer NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX impact_essay_drafts_org_season_idx
  ON impact_essay_drafts(org_id, season_year, created_at DESC);

ALTER TABLE impact_essay_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY impact_essay_drafts_member_read ON impact_essay_drafts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY impact_essay_drafts_member_insert ON impact_essay_drafts FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND generated_by = current_app_user_id());
CREATE POLICY impact_essay_drafts_member_update ON impact_essay_drafts FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY impact_essay_drafts_member_delete ON impact_essay_drafts FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON impact_essay_drafts TO vantage_app, vantage_worker;
