-- A team's choice about Vantage training its own models on the team's AI activity.
--
-- The Privacy Policy says Vantage may use prompts, context, responses and tool traces from its
-- AI features to train, fine-tune and evaluate in-house models. Owners and admins can now turn
-- that off for their team. No row means the policy's default (allowed); a row with
-- training_allowed = false means none of that team's AI activity may be used for training.
--
-- There is no training pipeline today. ai_runs_training_eligible is the one sanctioned source
-- for any future one: it is readable only by the worker role and leaves out every team that
-- turned training off, so an export cannot forget to honour the choice.

CREATE TABLE IF NOT EXISTS org_ai_training_choice (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  training_allowed boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE org_ai_training_choice ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_ai_training_choice_read ON org_ai_training_choice;
CREATE POLICY org_ai_training_choice_read ON org_ai_training_choice
  FOR SELECT TO vantage_app USING (is_org_member(org_id));

DROP POLICY IF EXISTS org_ai_training_choice_insert ON org_ai_training_choice;
CREATE POLICY org_ai_training_choice_insert ON org_ai_training_choice
  FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND updated_by = current_app_user_id());

DROP POLICY IF EXISTS org_ai_training_choice_update ON org_ai_training_choice;
CREATE POLICY org_ai_training_choice_update ON org_ai_training_choice
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND updated_by = current_app_user_id());

GRANT SELECT, INSERT, UPDATE ON org_ai_training_choice TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_ai_training_choice TO vantage_worker;

-- The only place a training job may read AI activity from.
CREATE OR REPLACE VIEW ai_runs_training_eligible AS
  SELECT r.*
    FROM ai_runs r
   WHERE NOT EXISTS (
     SELECT 1 FROM org_ai_training_choice c
      WHERE c.org_id = r.org_id AND c.training_allowed = false
   );

REVOKE ALL ON ai_runs_training_eligible FROM PUBLIC;
GRANT SELECT ON ai_runs_training_eligible TO vantage_worker;
