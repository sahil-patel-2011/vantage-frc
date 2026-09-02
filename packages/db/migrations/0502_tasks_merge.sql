-- One task list. build_tasks (0044, the build-season board) becomes the
-- canonical store for team work; team_todos (0162, the Soft-UI todo list) is
-- folded into it. team_todos stays in place because other readers still point
-- at it, but /api/todos and /api/tasks now share one store over build_tasks.
--
-- Columns team_todos had that build_tasks lacked:
--   assignee_user_id  — a real member (build_tasks only had free-text assignee)
--   subteam_id        — calendar subteam tag
--   completed_by      — who marked it done (done_at already existed)
-- notes/due_on/created_by/updated_at already existed; team_todos.status
-- 'doing' maps to 'in_progress'. legacy_source/legacy_id make the backfill
-- idempotent — re-running this migration never duplicates a todo.

ALTER TABLE build_tasks
  ADD COLUMN IF NOT EXISTS assignee_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subteam_id uuid REFERENCES team_subteams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS legacy_source text CHECK (legacy_source IS NULL OR legacy_source IN ('team_todos')),
  ADD COLUMN IF NOT EXISTS legacy_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS build_tasks_legacy_uidx
  ON build_tasks(legacy_source, legacy_id)
  WHERE legacy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS build_tasks_org_assignee_user_idx
  ON build_tasks(org_id, assignee_user_id)
  WHERE assignee_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS build_tasks_org_subteam_idx
  ON build_tasks(org_id, subteam_id)
  WHERE subteam_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS build_tasks_org_status_due_idx
  ON build_tasks(org_id, status, due_on NULLS LAST);

-- Backfill every team_todos row exactly once.
INSERT INTO build_tasks (
  org_id, title, subsystem, status, priority, assignee, estimate_hours, due_on,
  blocked_reason, notes, done_at, season_year, created_by, created_at, updated_at,
  assignee_user_id, subteam_id, completed_by, legacy_source, legacy_id
)
SELECT
  t.org_id,
  t.title,
  'general',
  CASE t.status WHEN 'doing' THEN 'in_progress' WHEN 'done' THEN 'done' ELSE 'todo' END,
  'normal',
  NULLIF(btrim(COALESCE(u.name, '')), ''),
  NULL,
  t.due_on,
  NULL,
  NULLIF(t.notes, ''),
  t.completed_at,
  EXTRACT(YEAR FROM t.created_at)::integer,
  t.created_by,
  t.created_at,
  t.updated_at,
  t.assignee_user_id,
  t.subteam_id,
  t.completed_by,
  'team_todos',
  t.id
FROM team_todos t
LEFT JOIN users u ON u.id = t.assignee_user_id
WHERE NOT EXISTS (
  SELECT 1 FROM build_tasks b WHERE b.legacy_source = 'team_todos' AND b.legacy_id = t.id
);

-- Mirror the member assignee into the collaborative assignee list (0182) so
-- the board's name-based workload view sees migrated todos too.
INSERT INTO build_task_assignees (task_id, org_id, assignee, added_by)
SELECT b.id, b.org_id, btrim(u.name), b.created_by
FROM build_tasks b
JOIN users u ON u.id = b.assignee_user_id
WHERE b.legacy_source = 'team_todos'
  AND btrim(COALESCE(u.name, '')) <> ''
ON CONFLICT DO NOTHING;
