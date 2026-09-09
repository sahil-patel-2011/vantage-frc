-- Team Forms: one general-purpose form engine for the whole product.
--
-- Why this exists rather than extending scout_forms (0258): that table is typed
-- to scouting. `form_kind` is `scout_schema_type`, publishing writes into
-- `scout_schemas`, and its field types are match/pit specific (drivetrain_type,
-- robot_image). It also cannot be reached without an active TBA event, so a
-- team cannot author anything in the preseason -- which is when tryout forms,
-- intake forms and permission slips actually get written.
--
-- The things an FRC team needs a form for are mostly not scouting:
--   new-student intake and tryouts, mentor sign-up and background-check status,
--   parent/guardian contact and consent, dues and payment tracking, travel and
--   medical forms, subteam preference surveys, meeting feedback, exit
--   interviews, award-submission questionnaires, safety quizzes.
-- Scouting is one consumer of a general engine, not the definition of it.
--
-- Answers are stored one row per question (form_answers) rather than a single
-- JSON blob per response, so aggregation for the results view is a GROUP BY
-- instead of a full scan and per-row JSON parse, and so a question can be
-- deleted without rewriting every response.

CREATE TABLE forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  -- What the form is for. Drives the results view's framing and the suggested
  -- starter questions; it is not a permission boundary.
  purpose text NOT NULL DEFAULT 'general'
    CHECK (purpose IN ('general', 'intake', 'tryout', 'mentor', 'parent',
                       'dues', 'travel', 'safety', 'feedback', 'scouting', 'award')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed')),
  -- Who may answer. 'members' requires a session and an org membership;
  -- 'link' lets anyone holding the token answer without an account, which is
  -- how a prospective student or a parent fills one in.
  audience text NOT NULL DEFAULT 'members'
    CHECK (audience IN ('members', 'link')),
  -- Non-guessable token for audience='link'. Null until the form is opened.
  share_token text UNIQUE,
  -- One response per member when true; enforced by a partial unique index below.
  one_response_per_member boolean NOT NULL DEFAULT true,
  closes_at timestamptz,
  season_year integer,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forms_org_status_idx ON forms (org_id, status, created_at DESC);
CREATE INDEX forms_org_purpose_idx ON forms (org_id, purpose);

CREATE TABLE form_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  position integer NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('short_text', 'long_text', 'number', 'single_select',
                    'multi_select', 'scale', 'yes_no', 'date', 'email', 'phone', 'counter')),
  label text NOT NULL,
  help text NOT NULL DEFAULT '',
  required boolean NOT NULL DEFAULT false,
  -- Kind-specific settings: {options:[...]} for selects, {min,max,step} for
  -- scale/number/counter. Kept as jsonb so a new kind does not need a migration.
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX form_questions_form_idx ON form_questions (form_id, position);

CREATE TABLE form_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  -- Null for link responses from someone with no account (a prospective
  -- student, a parent). Named contact details are then just answers.
  respondent_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  respondent_label text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_responses_form_idx ON form_responses (form_id, submitted_at DESC);
-- "One response per member" is a real constraint, not a UI convention.
CREATE UNIQUE INDEX form_responses_one_per_member_uq
  ON form_responses (form_id, respondent_user_id)
  WHERE respondent_user_id IS NOT NULL;

CREATE TABLE form_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  response_id uuid NOT NULL REFERENCES form_responses(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES form_questions(id) ON DELETE CASCADE,
  -- Text form of the answer, always populated, used for display and export.
  value_text text NOT NULL DEFAULT '',
  -- Populated only when the answer is genuinely numeric, so the results view
  -- can average/sum without parsing text. Null means "not a number", which is
  -- different from zero and is why this is nullable rather than defaulted.
  value_number numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (response_id, question_id)
);
CREATE INDEX form_answers_question_idx ON form_answers (question_id);

CREATE TABLE form_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_at timestamptz,
  assigned_by uuid NOT NULL REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, user_id)
);
CREATE INDEX form_assignments_user_idx ON form_assignments (user_id, org_id);

ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_assignments ENABLE ROW LEVEL SECURITY;

-- Forms: every member can see the team's forms and answer them; only
-- owners/admins author them. Authoring is a leadership act (it decides what the
-- team is asked), so it is role-gated rather than left to any member.
CREATE POLICY forms_member_read ON forms FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY forms_admin_insert ON forms FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
CREATE POLICY forms_admin_update ON forms FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
CREATE POLICY forms_admin_delete ON forms FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY form_questions_member_read ON form_questions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY form_questions_admin_write ON form_questions FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
CREATE POLICY form_questions_admin_update ON form_questions FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
CREATE POLICY form_questions_admin_delete ON form_questions FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

-- Responses: a member may insert their own and read their own back. Reading
-- everyone's answers is a leadership view -- a dues or exit-interview form must
-- not be readable by the whole team just because they are members.
CREATE POLICY form_responses_admin_read ON form_responses FOR SELECT TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR respondent_user_id = current_app_user_id()
  );
CREATE POLICY form_responses_member_insert ON form_responses FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND respondent_user_id = current_app_user_id());
CREATE POLICY form_responses_admin_delete ON form_responses FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY form_answers_admin_read ON form_answers FOR SELECT TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR EXISTS (
      SELECT 1 FROM form_responses r
       WHERE r.id = form_answers.response_id
         AND r.respondent_user_id = current_app_user_id()
    )
  );
CREATE POLICY form_answers_member_insert ON form_answers FOR INSERT TO vantage_app
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM form_responses r
       WHERE r.id = form_answers.response_id
         AND r.org_id = form_answers.org_id
         AND r.respondent_user_id = current_app_user_id()
    )
  );
CREATE POLICY form_answers_admin_delete ON form_answers FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

-- Assignments: you can see what you were asked to fill in; leadership manages them.
CREATE POLICY form_assignments_read ON form_assignments FOR SELECT TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR user_id = current_app_user_id()
  );
CREATE POLICY form_assignments_admin_insert ON form_assignments FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
CREATE POLICY form_assignments_admin_delete ON form_assignments FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON forms TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON form_questions TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON form_responses TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON form_answers TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON form_assignments TO vantage_app, vantage_worker;
