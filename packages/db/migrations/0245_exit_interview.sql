-- Graduation exit-interview capture: structured off-boarding prompts for outgoing members,
-- feeding the alumni/knowledge base. Distinct from onboarding/role records — this is the
-- one-time departure record (highlights, advice, documented skills, mentorship willingness).

CREATE TABLE exit_interview_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_name text NOT NULL,
  member_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'other'
    CHECK (role IN ('mechanical','electrical','programming','strategy','outreach','leadership','mentor','other')),
  years_on_team integer NOT NULL DEFAULT 0 CHECK (years_on_team >= 0),
  graduation_year integer NOT NULL,
  season_year integer NOT NULL,
  highlights text,
  advice_for_future text,
  skills_to_document text,
  willing_to_mentor boolean NOT NULL DEFAULT false,
  contact_email text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted')),
  submitted_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exit_interview_responses_org_season_idx
  ON exit_interview_responses(org_id, season_year, created_at DESC);

ALTER TABLE exit_interview_responses ENABLE ROW LEVEL SECURITY;

-- Any org member may read the alumni/off-boarding record and manage entries they file;
-- inserts stamp the submitting member.
CREATE POLICY exit_interview_responses_member_read ON exit_interview_responses FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY exit_interview_responses_member_insert ON exit_interview_responses FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND submitted_by = current_app_user_id());
CREATE POLICY exit_interview_responses_member_update ON exit_interview_responses FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY exit_interview_responses_member_delete ON exit_interview_responses FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON exit_interview_responses TO vantage_app, vantage_worker;
