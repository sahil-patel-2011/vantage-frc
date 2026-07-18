-- Driver tryouts: the scoring & selection rubric a team uses to pick its drive team
-- (driver, operator, human player). Candidates are the roster of people trying out;
-- evaluations are per-evaluator, per-session rubric scores (1-5) against a fixed set of
-- criteria so selection is backed by a record, not a vibe.

CREATE TABLE driver_tryouts_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  grade_level text,
  role_interest text NOT NULL DEFAULT 'any'
    CHECK (role_interest IN ('driver','operator','human_player','any')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','selected','cut','withdrawn')),
  notes text,
  season_year integer NOT NULL,
  added_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_tryouts_candidates_org_season_idx
  ON driver_tryouts_candidates(org_id, season_year, name);

ALTER TABLE driver_tryouts_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY driver_tryouts_candidates_member_read ON driver_tryouts_candidates FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY driver_tryouts_candidates_member_insert ON driver_tryouts_candidates FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND added_by = current_app_user_id());
CREATE POLICY driver_tryouts_candidates_member_update ON driver_tryouts_candidates FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY driver_tryouts_candidates_member_delete ON driver_tryouts_candidates FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON driver_tryouts_candidates TO vantage_app, vantage_worker;

CREATE TABLE driver_tryouts_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES driver_tryouts_candidates(id) ON DELETE CASCADE,
  evaluator_id uuid NOT NULL REFERENCES users(id),
  evaluated_on date NOT NULL,
  score_precision integer NOT NULL CHECK (score_precision BETWEEN 1 AND 5),
  score_awareness integer NOT NULL CHECK (score_awareness BETWEEN 1 AND 5),
  score_communication integer NOT NULL CHECK (score_communication BETWEEN 1 AND 5),
  score_composure integer NOT NULL CHECK (score_composure BETWEEN 1 AND 5),
  score_mechanical integer NOT NULL CHECK (score_mechanical BETWEEN 1 AND 5),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_tryouts_evaluations_org_candidate_idx
  ON driver_tryouts_evaluations(org_id, candidate_id, evaluated_on DESC);

ALTER TABLE driver_tryouts_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY driver_tryouts_evaluations_member_read ON driver_tryouts_evaluations FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY driver_tryouts_evaluations_member_insert ON driver_tryouts_evaluations FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND evaluator_id = current_app_user_id());
CREATE POLICY driver_tryouts_evaluations_member_update ON driver_tryouts_evaluations FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY driver_tryouts_evaluations_member_delete ON driver_tryouts_evaluations FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON driver_tryouts_evaluations TO vantage_app, vantage_worker;
