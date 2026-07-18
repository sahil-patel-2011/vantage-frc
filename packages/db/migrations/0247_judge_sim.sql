-- Judge-pitch simulator: an AI judge asks real FRC judging questions and grades the team's
-- answers against their own logged evidence, flagging claims that aren't backed by anything
-- on record. `judge_sim_evidence` is the evidence log (the facts a team can actually point to
-- for judges); `judge_sim_sessions` is the graded Q&A history run against that evidence.

CREATE TABLE judge_sim_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  claim text NOT NULL,
  category text NOT NULL DEFAULT 'technical'
    CHECK (category IN ('technical','strategy','teamwork','outreach','business','safety')),
  source_url text,
  occurred_on date,
  tags text[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX judge_sim_evidence_org_category_idx ON judge_sim_evidence(org_id, category, created_at DESC);

ALTER TABLE judge_sim_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY judge_sim_evidence_member_read ON judge_sim_evidence FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY judge_sim_evidence_member_insert ON judge_sim_evidence FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY judge_sim_evidence_member_update ON judge_sim_evidence FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY judge_sim_evidence_member_delete ON judge_sim_evidence FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON judge_sim_evidence TO vantage_app, vantage_worker;

CREATE TABLE judge_sim_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  category text NOT NULL DEFAULT 'technical'
    CHECK (category IN ('technical','strategy','teamwork','outreach','business','safety')),
  question text NOT NULL,
  answer_text text NOT NULL,
  verdict text NOT NULL DEFAULT 'unbacked'
    CHECK (verdict IN ('well_backed','partially_backed','unbacked')),
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  backed_claims text[] NOT NULL DEFAULT '{}',
  flagged_claims text[] NOT NULL DEFAULT '{}',
  matched_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  feedback text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX judge_sim_sessions_org_season_idx ON judge_sim_sessions(org_id, season_year, created_at DESC);

ALTER TABLE judge_sim_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY judge_sim_sessions_member_read ON judge_sim_sessions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY judge_sim_sessions_member_insert ON judge_sim_sessions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY judge_sim_sessions_member_update ON judge_sim_sessions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY judge_sim_sessions_member_delete ON judge_sim_sessions FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON judge_sim_sessions TO vantage_app, vantage_worker;
