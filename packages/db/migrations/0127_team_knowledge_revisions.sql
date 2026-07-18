-- Version history for the Team Knowledge doc: every save snapshots the content so
-- admins can see who changed the team's shared AI context and roll back if needed.

CREATE TABLE IF NOT EXISTS team_knowledge_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  content text NOT NULL,
  edited_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_knowledge_rev_org_idx ON team_knowledge_revisions(org_id, created_at DESC);

ALTER TABLE team_knowledge_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tkr_admin_read ON team_knowledge_revisions;
DROP POLICY IF EXISTS tkr_admin_insert ON team_knowledge_revisions;
CREATE POLICY tkr_admin_read ON team_knowledge_revisions FOR SELECT TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY tkr_admin_insert ON team_knowledge_revisions FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND edited_by = current_app_user_id());

GRANT SELECT, INSERT, DELETE ON team_knowledge_revisions TO vantage_app, vantage_worker;
