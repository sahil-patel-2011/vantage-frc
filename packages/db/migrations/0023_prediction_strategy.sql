CREATE TABLE predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_key text NOT NULL REFERENCES matches_ref(match_key) ON DELETE CASCADE,
  model_version text NOT NULL,
  p_red double precision NOT NULL CHECK (p_red >= 0 AND p_red <= 1),
  p_blue double precision NOT NULL CHECK (p_blue >= 0 AND p_blue <= 1),
  confidence_low double precision NOT NULL CHECK (confidence_low >= 0 AND confidence_low <= 1),
  confidence_high double precision NOT NULL CHECK (confidence_high >= 0 AND confidence_high <= 1),
  effective_sample_size double precision NOT NULL DEFAULT 0,
  key_factors jsonb NOT NULL DEFAULT '[]',
  features jsonb NOT NULL DEFAULT '{}',
  caveats jsonb NOT NULL DEFAULT '[]',
  actual_winner text CHECK (actual_winner IN ('red', 'blue', 'tie')),
  created_by uuid NOT NULL REFERENCES users(id),
  scored_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, match_key, model_version)
);
CREATE INDEX predictions_org_scored_idx ON predictions(org_id, scored_at DESC);

CREATE TABLE prediction_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prediction_id uuid NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  name text NOT NULL,
  assumptions jsonb NOT NULL,
  p_red double precision NOT NULL CHECK (p_red >= 0 AND p_red <= 1),
  p_blue double precision NOT NULL CHECK (p_blue >= 0 AND p_blue <= 1),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE strategy_playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  content jsonb NOT NULL,
  source_prediction_id uuid REFERENCES predictions(id) ON DELETE SET NULL,
  provenance jsonb NOT NULL DEFAULT '[]',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name, version)
);

CREATE TABLE match_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_key text NOT NULL REFERENCES matches_ref(match_key) ON DELETE CASCADE,
  prediction_id uuid REFERENCES predictions(id) ON DELETE SET NULL,
  playbook_id uuid REFERENCES strategy_playbooks(id) ON DELETE SET NULL,
  alliance text NOT NULL CHECK (alliance IN ('red', 'blue')),
  plan jsonb NOT NULL,
  debrief jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_strategies ENABLE ROW LEVEL SECURITY;

CREATE POLICY predictions_member ON predictions FOR ALL TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY scenarios_member ON prediction_scenarios FOR ALL TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY playbooks_member_read ON strategy_playbooks FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY playbooks_coach_write ON strategy_playbooks FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND created_by = current_app_user_id());
CREATE POLICY match_strategies_member ON match_strategies FOR ALL TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON predictions, prediction_scenarios, strategy_playbooks,
  match_strategies TO vantage_app, vantage_worker;
