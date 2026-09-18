-- CAD learning track: progress, reference parts, and graded submissions.
--
-- The mechanical/design counterpart to the programming onboarding guide. Three
-- tables, each answering a different question:
--
--   cad_learn_progress         which lessons has this student opened and finished
--   cad_learn_reference_parts  what is the correct answer for a lesson, per team
--   cad_learn_submissions      what did this student's part actually measure
--
-- WHY PROGRESS IS SERVER-SIDE HERE AND localStorage IN /dev-setup
--
-- The programming guide keeps "done" ticks in the browser, which is honest for
-- a personal checklist but useless to a mentor: nobody can see who is stuck.
-- The CAD track needs the mentor view, because the whole track ends in an
-- auto-graded part and "who has not submitted" is the question a design lead
-- actually asks. So progress lives in the database, scoped per team.
--
-- WHO SEES WHAT — the shape of 0602_announcement_acks, tightened
--
-- 0602 let every member read every acknowledgement, because an acknowledgement
-- is a public act within a team. Learning progress is not: "Maya has not
-- finished the fillets lesson" is a leadership fact, not a team-wide one, in
-- exactly the way 0611 argued for subteam progress. So:
--   * a student reads their OWN rows;
--   * owners and admins (the mentors and leads, in Vantage's role model — the
--     same bar 0611's get_subteam_progress uses) read the whole team;
--   * you may only ever write your own row. There is no policy under which one
--     student marks another student's lesson complete.
--
-- NOTHING HERE IS EVER A TYPED-IN NUMBER
--
-- Every mass and inertia column is written from a live Onshape
-- /massproperties read — for the reference part as well as the student's. A
-- lead cannot type "the answer is 0.42 kg". If Onshape cannot be read, no row
-- is written at all and the student is told why; there is deliberately no
-- "ungraded submission" state that could later be mistaken for a score.

-- ---------------------------------------------------------------------------
-- Progress
-- ---------------------------------------------------------------------------

CREATE TABLE cad_learn_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Matches Lesson.id in apps/web/lib/cad-learn/track.ts. Text, not a foreign
  -- key, for the same reason 0612 gave: the curriculum is content that changes
  -- between seasons and adding a lesson must not need a migration.
  lesson_id text NOT NULL CHECK (btrim(lesson_id) <> ''),
  viewed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Per team, not per person: a student who moves teams starts that team's
  -- track fresh, and a mentor's view never mixes in another org's rows.
  UNIQUE (org_id, user_id, lesson_id)
);
CREATE INDEX cad_learn_progress_org_lesson_idx ON cad_learn_progress (org_id, lesson_id);
CREATE INDEX cad_learn_progress_user_idx ON cad_learn_progress (org_id, user_id);

ALTER TABLE cad_learn_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY cad_learn_progress_read ON cad_learn_progress FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      user_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

CREATE POLICY cad_learn_progress_self_insert ON cad_learn_progress FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY cad_learn_progress_self_update ON cad_learn_progress FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

-- "Start this lesson over" is a student's own call.
CREATE POLICY cad_learn_progress_self_delete ON cad_learn_progress FOR DELETE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON cad_learn_progress TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------------------
-- Reference parts — the correct answer for one lesson, for one team
-- ---------------------------------------------------------------------------

CREATE TABLE cad_learn_reference_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lesson_id text NOT NULL CHECK (btrim(lesson_id) <> ''),
  onshape_document_id text NOT NULL CHECK (btrim(onshape_document_id) <> ''),
  onshape_workspace_id text NOT NULL CHECK (btrim(onshape_workspace_id) <> ''),
  onshape_element_id text NOT NULL CHECK (btrim(onshape_element_id) <> ''),
  -- Measured from Onshape at the moment the lead bound the part. A positive
  -- mass is the database's own guarantee that a real measurement happened:
  -- Onshape reports no mass for a part with no material assigned, and that
  -- path never reaches an INSERT.
  mass_kg double precision NOT NULL CHECK (mass_kg > 0),
  volume_m3 double precision CHECK (volume_m3 IS NULL OR volume_m3 > 0),
  -- Three PRINCIPAL moments, ascending, about the part's own centre of mass.
  -- Principal moments are invariant under translation and rotation, so a
  -- student who modelled the same part on a different plane still matches.
  -- The raw tensor and the centroid are deliberately not stored: Onshape's
  -- reported centre of mass moves with where the part sits, which is why the
  -- grader does not use it.
  principal_inertia_kg_m2 double precision[]
    CHECK (principal_inertia_kg_m2 IS NULL OR array_length(principal_inertia_kg_m2, 1) = 3),
  -- Both parts must be compared on the same material or the numbers mean
  -- nothing — mass and MOI are both linear in density.
  material text NOT NULL DEFAULT 'Cast iron' CHECK (btrim(material) <> ''),
  onshape_microversion_id text,
  measured_at timestamptz NOT NULL DEFAULT now(),
  measured_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, lesson_id)
);

ALTER TABLE cad_learn_reference_parts ENABLE ROW LEVEL SECURITY;

-- Every member reads the reference: a student needs to know a lesson is
-- gradeable before they spend an hour on it.
CREATE POLICY cad_learn_reference_member_read ON cad_learn_reference_parts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- Setting the answer is a lead's job. A student who could rebind the reference
-- to their own part would grade themselves against themselves.
CREATE POLICY cad_learn_reference_lead_insert ON cad_learn_reference_parts FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    AND measured_by = current_app_user_id()
  );

CREATE POLICY cad_learn_reference_lead_update ON cad_learn_reference_parts FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY cad_learn_reference_lead_delete ON cad_learn_reference_parts FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON cad_learn_reference_parts TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------------------
-- Submissions — what a student's part actually measured
-- ---------------------------------------------------------------------------

CREATE TABLE cad_learn_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id text NOT NULL CHECK (btrim(lesson_id) <> ''),
  onshape_document_id text NOT NULL CHECK (btrim(onshape_document_id) <> ''),
  onshape_workspace_id text NOT NULL CHECK (btrim(onshape_workspace_id) <> ''),
  onshape_element_id text NOT NULL CHECK (btrim(onshape_element_id) <> ''),
  mass_kg double precision NOT NULL CHECK (mass_kg > 0),
  volume_m3 double precision CHECK (volume_m3 IS NULL OR volume_m3 > 0),
  principal_inertia_kg_m2 double precision[]
    CHECK (principal_inertia_kg_m2 IS NULL OR array_length(principal_inertia_kg_m2, 1) = 3),
  -- Signed, against the reference. Positive means heavier / more spread out.
  mass_percent_difference double precision NOT NULL,
  -- NULL when Onshape returned no principal moments for one of the two parts.
  -- NULL means "not measured", and the UI says so rather than showing a zero.
  inertia_percent_difference double precision,
  overall_band text NOT NULL CHECK (overall_band IN ('match', 'close', 'off')),
  material text NOT NULL DEFAULT 'Cast iron' CHECK (btrim(material) <> ''),
  graded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cad_learn_submissions_org_lesson_idx ON cad_learn_submissions (org_id, lesson_id, graded_at DESC);
CREATE INDEX cad_learn_submissions_user_idx ON cad_learn_submissions (org_id, user_id, graded_at DESC);

ALTER TABLE cad_learn_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY cad_learn_submissions_read ON cad_learn_submissions FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      user_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

-- You submit your own work and nobody else's.
CREATE POLICY cad_learn_submissions_self_insert ON cad_learn_submissions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

-- Deliberately no UPDATE policy. An attempt is a record of what a part measured
-- at a moment in time; improving it means grading again, which appends a new
-- row. That keeps the history a mentor sees honest.
CREATE POLICY cad_learn_submissions_self_delete ON cad_learn_submissions FOR DELETE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id());

GRANT SELECT, INSERT, DELETE ON cad_learn_submissions TO vantage_app, vantage_worker;
