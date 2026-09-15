-- Durable working-memory todos for multi-step agents (autonomous / CAD / chat).
-- Goal + open todos must survive compaction and crash/resume. Resume hop index
-- is derived from max(autonomous_agent_steps.sequence) — no resume_cursor column.

CREATE TABLE agent_working_todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  scope text NOT NULL
    CHECK (scope IN ('autonomous', 'cad', 'chat')),
  run_id uuid,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'done', 'blocked')),
  sort_key integer NOT NULL DEFAULT 0 CHECK (sort_key >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_working_todos_org_scope_run_idx
  ON agent_working_todos (org_id, user_id, scope, run_id, sort_key);

CREATE INDEX agent_working_todos_org_created_idx
  ON agent_working_todos (org_id, created_at DESC);

-- Nullable run_id: chat/CAD may seed without a run. Two partial uniques so
-- resume re-seed does not duplicate labels for the same scope+run.
CREATE UNIQUE INDEX agent_working_todos_run_label_uidx
  ON agent_working_todos (org_id, user_id, scope, run_id, label)
  WHERE run_id IS NOT NULL;

CREATE UNIQUE INDEX agent_working_todos_null_run_label_uidx
  ON agent_working_todos (org_id, user_id, scope, label)
  WHERE run_id IS NULL;

ALTER TABLE agent_working_todos ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_working_todos_member_read ON agent_working_todos
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY agent_working_todos_member_insert ON agent_working_todos
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY agent_working_todos_owner_update ON agent_working_todos
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY agent_working_todos_admin_delete ON agent_working_todos
  FOR DELETE TO vantage_app
  USING (
    user_id = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_working_todos
  TO vantage_app, vantage_worker;
