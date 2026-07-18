-- Cross-season subsystem reuse advisor: persisted reuse-vs-avoid assessments for a subsystem,
-- computed from prior-season robot_subsystems + fmea_failures + design_reviews history (all
-- existing tables, read-only joins). No new subsystem/FMEA/design-review schema is introduced
-- here — only the assessment record itself, prefixed with the feature slug.

CREATE TABLE reuse_advisor_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  subsystem_name text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('drivetrain', 'intake', 'shooter', 'arm', 'elevator', 'climber', 'turret', 'indexer', 'other')),
  source_subsystem_id uuid REFERENCES robot_subsystems(id) ON DELETE SET NULL,
  source_season_year integer,
  fmea_failure_count integer NOT NULL DEFAULT 0 CHECK (fmea_failure_count >= 0),
  fmea_high_severity_count integer NOT NULL DEFAULT 0 CHECK (fmea_high_severity_count >= 0),
  design_review_count integer NOT NULL DEFAULT 0 CHECK (design_review_count >= 0),
  design_review_pass_count integer NOT NULL DEFAULT 0 CHECK (design_review_pass_count >= 0),
  recommendation text NOT NULL CHECK (recommendation IN ('reuse', 'modify', 'avoid')),
  confidence numeric(4, 3) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  rationale text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reuse_advisor_assessments_org_season_idx
  ON reuse_advisor_assessments(org_id, season_year, created_at DESC);
CREATE INDEX reuse_advisor_assessments_org_subsystem_idx
  ON reuse_advisor_assessments(org_id, subsystem_name);

ALTER TABLE reuse_advisor_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY reuse_advisor_assessments_member_read ON reuse_advisor_assessments FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY reuse_advisor_assessments_member_insert ON reuse_advisor_assessments FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY reuse_advisor_assessments_member_update ON reuse_advisor_assessments FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY reuse_advisor_assessments_member_delete ON reuse_advisor_assessments FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON reuse_advisor_assessments TO vantage_app, vantage_worker;
