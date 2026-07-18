-- Sketch-to-Brief: turn a kickoff whiteboard sketch (transcribed as text notes —
-- mechanism intent, labels, rough dimensions) into a grounded CAD brief draft plus
-- a rule-compliance check cross-referenced against the org's own kickoff rule
-- notes and design priorities. Distinct from 0067 kickoff_analysis (the raw
-- rules/priorities workbench) and from packages/agent's cad_jobs (the full
-- CAD-agent pipeline) — this is the lightweight "photo of the whiteboard to
-- a first-pass brief" step that happens before a CAD job is opened.

CREATE TABLE sketch_to_brief_sketches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 1992 AND 2100),
  title text NOT NULL,
  notes text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('intake', 'shooter', 'climb', 'drivetrain', 'manipulator', 'other')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'brief_ready')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sketch_to_brief_sketches_org_idx ON sketch_to_brief_sketches(org_id, season_year, created_at DESC);

CREATE TABLE sketch_to_brief_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sketch_id uuid NOT NULL REFERENCES sketch_to_brief_sketches(id) ON DELETE CASCADE,
  title text NOT NULL,
  brief jsonb NOT NULL,
  rule_flag_count integer NOT NULL DEFAULT 0 CHECK (rule_flag_count >= 0),
  generated_by text NOT NULL DEFAULT 'local' CHECK (generated_by IN ('ai', 'local')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sketch_to_brief_briefs_org_idx ON sketch_to_brief_briefs(org_id, sketch_id, created_at DESC);

ALTER TABLE sketch_to_brief_sketches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sketch_to_brief_briefs ENABLE ROW LEVEL SECURITY;

-- Sketch-to-Brief is a whole-team kickoff activity: any org member may read and
-- manage entries; inserts stamp the author.
CREATE POLICY sketch_to_brief_sketches_member_read ON sketch_to_brief_sketches FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY sketch_to_brief_sketches_member_insert ON sketch_to_brief_sketches FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY sketch_to_brief_sketches_member_update ON sketch_to_brief_sketches FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY sketch_to_brief_sketches_member_delete ON sketch_to_brief_sketches FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY sketch_to_brief_briefs_member_read ON sketch_to_brief_briefs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY sketch_to_brief_briefs_member_insert ON sketch_to_brief_briefs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY sketch_to_brief_briefs_member_update ON sketch_to_brief_briefs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY sketch_to_brief_briefs_member_delete ON sketch_to_brief_briefs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON sketch_to_brief_sketches, sketch_to_brief_briefs TO vantage_app, vantage_worker;
