-- Kickoff & Game Analysis.
-- Kickoff-weekend workspace: break the new game down into scoring actions
-- (points vs estimated cycle time), derive a weighted design priority list from
-- the best-value actions, and track rules questions until the manual answers
-- them. Everything is scoped per season so past kickoffs stay browsable.

CREATE TABLE game_scoring_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 1992 AND 2100),
  label text NOT NULL,
  phase text NOT NULL DEFAULT 'teleop' CHECK (phase IN ('auto', 'teleop', 'endgame')),
  points numeric(6,1) NOT NULL CHECK (points >= 0 AND points <= 1000),
  est_seconds numeric(6,1) CHECK (est_seconds IS NULL OR (est_seconds > 0 AND est_seconds <= 600)),
  notes text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX game_scoring_actions_org_idx ON game_scoring_actions(org_id, season_year, sort_order);

CREATE TABLE design_priorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 1992 AND 2100),
  capability text NOT NULL,
  rationale text NOT NULL DEFAULT '',
  weight integer NOT NULL DEFAULT 3 CHECK (weight BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'prototyping', 'committed', 'cut')),
  linked_action_id uuid REFERENCES game_scoring_actions(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX design_priorities_org_idx ON design_priorities(org_id, season_year, weight DESC);

CREATE TABLE kickoff_rule_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 1992 AND 2100),
  question text NOT NULL,
  answer text NOT NULL DEFAULT '',
  rule_ref text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kickoff_rule_notes_org_idx ON kickoff_rule_notes(org_id, season_year);

ALTER TABLE game_scoring_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_priorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE kickoff_rule_notes ENABLE ROW LEVEL SECURITY;

-- Kickoff analysis is a whole-team activity: members read/write; deletes are
-- limited to the row's creator or an owner/admin.
CREATE POLICY game_scoring_actions_read ON game_scoring_actions FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY game_scoring_actions_insert ON game_scoring_actions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY game_scoring_actions_update ON game_scoring_actions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY game_scoring_actions_delete ON game_scoring_actions FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY design_priorities_read ON design_priorities FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY design_priorities_insert ON design_priorities FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY design_priorities_update ON design_priorities FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY design_priorities_delete ON design_priorities FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY kickoff_rule_notes_read ON kickoff_rule_notes FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY kickoff_rule_notes_insert ON kickoff_rule_notes FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY kickoff_rule_notes_update ON kickoff_rule_notes FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY kickoff_rule_notes_delete ON kickoff_rule_notes FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON game_scoring_actions, design_priorities, kickoff_rule_notes TO vantage_app, vantage_worker;
