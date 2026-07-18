-- Team AI Prompt Library: reusable, team-authored prompts so good ways of asking
-- the assistant are captured and shared instead of re-invented each time. Any
-- member can read and add; admins or the author can remove.

CREATE TABLE team_prompt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  body text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_prompt_templates_org_idx ON team_prompt_templates(org_id, category);

ALTER TABLE team_prompt_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_prompts_member_read ON team_prompt_templates FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY team_prompts_member_insert ON team_prompt_templates FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY team_prompts_author_update ON team_prompt_templates FOR UPDATE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (is_org_member(org_id));
CREATE POLICY team_prompts_delete ON team_prompt_templates FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
GRANT SELECT, INSERT, UPDATE, DELETE ON team_prompt_templates TO vantage_app, vantage_worker;
