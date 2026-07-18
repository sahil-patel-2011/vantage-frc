-- Practice Planner — drive-team sessions, goals, and cycle-time reps.
-- Optional build_task link (0044). attendance_event_id is a soft UUID reference
-- so the planner can attach roll-call rows when an attendance module is present.
-- Idempotent across older driver_sessions shapes that predate attendance/task links.

CREATE TABLE IF NOT EXISTS driver_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  event_key text REFERENCES events_ref(event_key),
  session_date date NOT NULL DEFAULT current_date,
  driver_user_id uuid REFERENCES users(id),
  driver_name text,
  location text NOT NULL DEFAULT '',
  goal text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  attendance_event_id uuid,
  build_task_id uuid REFERENCES build_tasks(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE driver_sessions ADD COLUMN IF NOT EXISTS attendance_event_id uuid;
ALTER TABLE driver_sessions ADD COLUMN IF NOT EXISTS build_task_id uuid REFERENCES build_tasks(id) ON DELETE SET NULL;
ALTER TABLE driver_sessions ADD COLUMN IF NOT EXISTS goal text NOT NULL DEFAULT '';
ALTER TABLE driver_sessions ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE driver_sessions ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS driver_sessions_org_idx ON driver_sessions(org_id, session_date DESC);
CREATE INDEX IF NOT EXISTS driver_sessions_attendance_idx ON driver_sessions(attendance_event_id)
  WHERE attendance_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS driver_sessions_task_idx ON driver_sessions(build_task_id)
  WHERE build_task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS driver_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES driver_sessions(id) ON DELETE CASCADE,
  action text NOT NULL,
  seconds numeric(6, 2) CHECK (seconds IS NULL OR (seconds >= 0 AND seconds <= 3600)),
  success boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '',
  rep_index integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS driver_cycles_session_idx ON driver_cycles(session_id, rep_index);

ALTER TABLE driver_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_cycles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_sessions_read ON driver_sessions;
DROP POLICY IF EXISTS driver_sessions_insert ON driver_sessions;
DROP POLICY IF EXISTS driver_sessions_update ON driver_sessions;
DROP POLICY IF EXISTS driver_sessions_delete ON driver_sessions;
CREATE POLICY driver_sessions_read ON driver_sessions FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY driver_sessions_insert ON driver_sessions FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY driver_sessions_update ON driver_sessions FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY driver_sessions_delete ON driver_sessions FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

DROP POLICY IF EXISTS driver_cycles_read ON driver_cycles;
DROP POLICY IF EXISTS driver_cycles_insert ON driver_cycles;
DROP POLICY IF EXISTS driver_cycles_update ON driver_cycles;
DROP POLICY IF EXISTS driver_cycles_delete ON driver_cycles;
CREATE POLICY driver_cycles_read ON driver_cycles FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY driver_cycles_insert ON driver_cycles FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY driver_cycles_update ON driver_cycles FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY driver_cycles_delete ON driver_cycles FOR DELETE TO vantage_app USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON driver_sessions, driver_cycles TO vantage_app, vantage_worker;
