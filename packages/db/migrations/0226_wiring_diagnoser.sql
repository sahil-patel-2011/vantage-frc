-- Wiring/power fault diagnoser (Build pillar).
-- From a board photo + the team's stored wiring diagram + power budget, deterministically flag
-- miswires (device on the wrong channel), undersized breakers (breaker below expected draw, or a
-- breaker rating that exceeds the installed wire's ampacity), and over-spec channels (draw close
-- to the breaker's trip point). Expected circuits (diagram + budget) and observed circuits (board
-- inspection) are both stored per check so the flagged diff stays auditable.

CREATE TABLE wiring_diagnoser_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  board_name text NOT NULL,
  photo_url text,
  expected_circuits jsonb NOT NULL DEFAULT '[]'::jsonb,
  observed_circuits jsonb NOT NULL DEFAULT '[]'::jsonb,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_score numeric(4, 3) NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 1),
  summary text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX wiring_diagnoser_checks_org_season_idx
  ON wiring_diagnoser_checks(org_id, season_year, created_at DESC);

ALTER TABLE wiring_diagnoser_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY wiring_diagnoser_checks_member_read ON wiring_diagnoser_checks FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY wiring_diagnoser_checks_member_insert ON wiring_diagnoser_checks FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY wiring_diagnoser_checks_member_update ON wiring_diagnoser_checks FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY wiring_diagnoser_checks_member_delete ON wiring_diagnoser_checks FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON wiring_diagnoser_checks TO vantage_app, vantage_worker;
