-- Shared team todo / goals list: org-scoped tasks with member assignees, optional
-- calendar subteam tags, due dates, and todo/doing/done status. No seeded demos.
-- Members may notify assignees when a todo is assigned or completed.

CREATE TABLE IF NOT EXISTS team_todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'doing', 'done')),
  assignee_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  subteam_id uuid REFERENCES team_subteams(id) ON DELETE SET NULL,
  due_on date,
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_todos_org_status_idx
  ON team_todos(org_id, status, due_on NULLS LAST);
CREATE INDEX IF NOT EXISTS team_todos_org_assignee_idx
  ON team_todos(org_id, assignee_user_id)
  WHERE assignee_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS team_todos_org_subteam_idx
  ON team_todos(org_id, subteam_id)
  WHERE subteam_id IS NOT NULL;

ALTER TABLE team_todos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_todos_member_read ON team_todos;
DROP POLICY IF EXISTS team_todos_member_insert ON team_todos;
DROP POLICY IF EXISTS team_todos_member_update ON team_todos;
DROP POLICY IF EXISTS team_todos_member_delete ON team_todos;

CREATE POLICY team_todos_member_read ON team_todos FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY team_todos_member_insert ON team_todos FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY team_todos_member_update ON team_todos FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY team_todos_member_delete ON team_todos FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON team_todos TO vantage_app, vantage_worker;

-- Peer notify for assign / complete (self-insert already covered by notifications_self).
DROP POLICY IF EXISTS notifications_todo_peer_insert ON notifications;
CREATE POLICY notifications_todo_peer_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type IN ('todo_assigned', 'todo_completed')
    AND org_id IS NOT NULL
    AND is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );
