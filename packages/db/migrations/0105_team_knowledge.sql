-- Team Knowledge Base: one admin-authored markdown document per team that the
-- FRC Assistant reads on every team-scope chat, so team-specific context (robot,
-- subsystems, strategy priorities, key people, conventions) is always in reach.
-- Stored only in that team's row and injected only for that org via RLS.

CREATE TABLE team_knowledge (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  content text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE team_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_knowledge_member_read ON team_knowledge FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY team_knowledge_admin_write ON team_knowledge FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND updated_by = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON team_knowledge TO vantage_app, vantage_worker;
