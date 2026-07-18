-- Rule-change impact analyzer: on kickoff, log the new-season game-manual rule changes and diff
-- them against the team's historical subsystem library (existing robot_subsystems, read-only
-- join) to flag which prior-season subsystems are still legal/relevant vs need rework or are
-- outright blocked by a new rule. Two new tables, both prefixed with the feature slug: the rule
-- changes themselves, and the persisted per-subsystem impact assessment.

CREATE TABLE rule_impact_rule_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  rule_code text NOT NULL,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('dimension', 'weight', 'material', 'mechanism', 'motor_limit', 'safety', 'scoring', 'other')),
  severity text NOT NULL DEFAULT 'minor'
    CHECK (severity IN ('minor', 'major', 'blocking')),
  subsystem_category text
    CHECK (subsystem_category IS NULL OR subsystem_category IN
      ('drivetrain', 'intake', 'shooter', 'arm', 'elevator', 'climber', 'turret', 'indexer', 'other')),
  summary text NOT NULL DEFAULT '',
  source_url text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rule_impact_rule_changes_org_season_idx
  ON rule_impact_rule_changes(org_id, season_year, created_at DESC);

ALTER TABLE rule_impact_rule_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY rule_impact_rule_changes_member_read ON rule_impact_rule_changes FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY rule_impact_rule_changes_member_insert ON rule_impact_rule_changes FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY rule_impact_rule_changes_member_update ON rule_impact_rule_changes FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY rule_impact_rule_changes_member_delete ON rule_impact_rule_changes FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON rule_impact_rule_changes TO vantage_app, vantage_worker;

CREATE TABLE rule_impact_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  subsystem_name text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('drivetrain', 'intake', 'shooter', 'arm', 'elevator', 'climber', 'turret', 'indexer', 'other')),
  source_subsystem_id uuid REFERENCES robot_subsystems(id) ON DELETE SET NULL,
  source_season_year integer,
  matched_rule_count integer NOT NULL DEFAULT 0 CHECK (matched_rule_count >= 0),
  blocking_rule_count integer NOT NULL DEFAULT 0 CHECK (blocking_rule_count >= 0),
  major_rule_count integer NOT NULL DEFAULT 0 CHECK (major_rule_count >= 0),
  impact_status text NOT NULL CHECK (impact_status IN ('still_legal', 'needs_rework', 'blocked')),
  confidence numeric(4, 3) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  rationale text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rule_impact_assessments_org_season_idx
  ON rule_impact_assessments(org_id, season_year, created_at DESC);
CREATE INDEX rule_impact_assessments_org_subsystem_idx
  ON rule_impact_assessments(org_id, subsystem_name);

ALTER TABLE rule_impact_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY rule_impact_assessments_member_read ON rule_impact_assessments FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY rule_impact_assessments_member_insert ON rule_impact_assessments FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY rule_impact_assessments_member_update ON rule_impact_assessments FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY rule_impact_assessments_member_delete ON rule_impact_assessments FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON rule_impact_assessments TO vantage_app, vantage_worker;
