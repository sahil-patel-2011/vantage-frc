-- Build Task Board: lightweight engineering task tracker for the build season. Subsystem
-- work items with status/priority/owner/due date; the app derives the board, progress
-- metrics, and a prioritized focus list. Org-scoped, collaborative, per-org RLS.

CREATE TABLE build_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  subsystem text NOT NULL DEFAULT 'general',
  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','blocked','done','archived')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','critical')),
  assignee text,
  estimate_hours numeric(6,2) CHECK (estimate_hours IS NULL OR estimate_hours >= 0),
  due_on date,
  blocked_reason text,
  notes text,
  done_at timestamptz,
  season_year integer NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX build_tasks_org_season_status_idx ON build_tasks(org_id, season_year, status);

ALTER TABLE build_tasks ENABLE ROW LEVEL SECURITY;

-- Any org member may read and manage the shared board; inserts stamp the author.
CREATE POLICY build_tasks_member_read ON build_tasks FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY build_tasks_member_insert ON build_tasks FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY build_tasks_member_update ON build_tasks FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY build_tasks_member_delete ON build_tasks FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON build_tasks TO vantage_app, vantage_worker;
