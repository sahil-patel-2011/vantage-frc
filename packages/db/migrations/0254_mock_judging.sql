-- Mock Judging: practice judging sessions with an AI judge + rubric scoring & feedback for
-- award prep. Distinct from 0247 judge_sim (which grades single answers as backed/unbacked
-- against evidence): mock_judging runs a full rubric-scored practice round per award category
-- and grades a set of criteria (0-5 each), grounding feedback in the team's own logged prep
-- notes. `mock_judging_prep_notes` is the talking-point log a session can be graded against;
-- `mock_judging_sessions` is the rubric-scored practice history.

CREATE TABLE mock_judging_prep_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  note text NOT NULL,
  award_category text NOT NULL DEFAULT 'general'
    CHECK (award_category IN ('general','chairmans','engineering_inspiration','impact','innovation_in_control','excellence_in_engineering','rookie_all_star','safety','other')),
  tags text[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mock_judging_prep_notes_org_category_idx ON mock_judging_prep_notes(org_id, award_category, created_at DESC);

ALTER TABLE mock_judging_prep_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY mock_judging_prep_notes_member_read ON mock_judging_prep_notes FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY mock_judging_prep_notes_member_insert ON mock_judging_prep_notes FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY mock_judging_prep_notes_member_update ON mock_judging_prep_notes FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY mock_judging_prep_notes_member_delete ON mock_judging_prep_notes FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON mock_judging_prep_notes TO vantage_app, vantage_worker;

CREATE TABLE mock_judging_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  award_category text NOT NULL DEFAULT 'general'
    CHECK (award_category IN ('general','chairmans','engineering_inspiration','impact','innovation_in_control','excellence_in_engineering','rookie_all_star','safety','other')),
  question text NOT NULL,
  answer_text text NOT NULL,
  criteria_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  overall_score numeric(4,2) NOT NULL DEFAULT 0 CHECK (overall_score >= 0 AND overall_score <= 5),
  strengths text[] NOT NULL DEFAULT '{}',
  improvements text[] NOT NULL DEFAULT '{}',
  feedback text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mock_judging_sessions_org_season_idx ON mock_judging_sessions(org_id, season_year, created_at DESC);

ALTER TABLE mock_judging_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY mock_judging_sessions_member_read ON mock_judging_sessions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY mock_judging_sessions_member_insert ON mock_judging_sessions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY mock_judging_sessions_member_update ON mock_judging_sessions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY mock_judging_sessions_member_delete ON mock_judging_sessions FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON mock_judging_sessions TO vantage_app, vantage_worker;
