-- Duty roster: assign scouting / pit / drive team / outreach slots to members
-- or subteams. Duties optionally link a subteam_calendar_events row so they
-- appear on the team calendar. Empty until leads create assignments — no seeds.

CREATE TABLE IF NOT EXISTS duty_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  kind text NOT NULL DEFAULT 'scouting'
    CHECK (kind IN ('scouting', 'pit', 'drive_team', 'outreach')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz CHECK (ends_at IS NULL OR ends_at >= starts_at),
  subteam_id uuid REFERENCES team_subteams(id) ON DELETE SET NULL,
  assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  calendar_event_id uuid REFERENCES subteam_calendar_events(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS duty_assignments_org_starts_idx
  ON duty_assignments(org_id, starts_at);
CREATE INDEX IF NOT EXISTS duty_assignments_assignee_idx
  ON duty_assignments(org_id, assigned_user_id, starts_at)
  WHERE assigned_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS duty_assignments_subteam_idx
  ON duty_assignments(org_id, subteam_id, starts_at)
  WHERE subteam_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS duty_assignments_calendar_event_idx
  ON duty_assignments(calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;

ALTER TABLE duty_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS duty_assignments_read ON duty_assignments;
DROP POLICY IF EXISTS duty_assignments_insert ON duty_assignments;
DROP POLICY IF EXISTS duty_assignments_update ON duty_assignments;
DROP POLICY IF EXISTS duty_assignments_delete ON duty_assignments;

-- Whole team can see the roster; any member may create (stamped as author);
-- creators and owners/admins may edit or remove.
CREATE POLICY duty_assignments_read ON duty_assignments
  FOR SELECT TO vantage_app USING (is_org_member(org_id));

CREATE POLICY duty_assignments_insert ON duty_assignments
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());

CREATE POLICY duty_assignments_update ON duty_assignments
  FOR UPDATE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  )
  WITH CHECK (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

CREATE POLICY duty_assignments_delete ON duty_assignments
  FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON duty_assignments TO vantage_app, vantage_worker;
