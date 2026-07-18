-- Subteam calendars — org-scoped groups with a filterable practice/build/
-- deadline/event calendar. Links optionally into attendance roll-call (0047)
-- and practice sessions (0103) so those modules stay the source of truth for
-- presence and cycle times. No seeded demo subteams.

CREATE TABLE team_subteams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  color text NOT NULL DEFAULT '#1f4fd6'
    CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
CREATE INDEX team_subteams_org_idx ON team_subteams(org_id, sort_order, lower(name));

-- Membership is many-to-many: a person can sit on Mechanical AND Programming.
CREATE TABLE team_subteam_members (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subteam_id uuid NOT NULL REFERENCES team_subteams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subteam_id, user_id)
);
CREATE INDEX team_subteam_members_user_idx ON team_subteam_members(org_id, user_id);
CREATE INDEX team_subteam_members_org_idx ON team_subteam_members(org_id, subteam_id);

CREATE TABLE subteam_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- NULL subteam_id = whole-team / combined calendar entry.
  subteam_id uuid REFERENCES team_subteams(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  kind text NOT NULL DEFAULT 'practice'
    CHECK (kind IN ('practice', 'build', 'deadline', 'event', 'meeting', 'outreach', 'other')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz CHECK (ends_at IS NULL OR ends_at >= starts_at),
  location text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  -- Optional links — do not duplicate attendance / practice rows.
  attendance_event_id uuid REFERENCES attendance_events(id) ON DELETE SET NULL,
  milestone_id uuid REFERENCES season_milestones(id) ON DELETE SET NULL,
  -- Soft UUID (practice tables may be absent in some environments).
  driver_session_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subteam_calendar_events_org_idx
  ON subteam_calendar_events(org_id, starts_at DESC);
CREATE INDEX subteam_calendar_events_subteam_idx
  ON subteam_calendar_events(org_id, subteam_id, starts_at DESC)
  WHERE subteam_id IS NOT NULL;
CREATE INDEX subteam_calendar_events_attendance_idx
  ON subteam_calendar_events(attendance_event_id)
  WHERE attendance_event_id IS NOT NULL;

ALTER TABLE team_subteams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_subteam_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE subteam_calendar_events ENABLE ROW LEVEL SECURITY;

-- Subteams + rosters: whole team can read; owners/admins create and assign.
CREATE POLICY team_subteams_read ON team_subteams
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY team_subteams_write ON team_subteams
  FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY team_subteam_members_read ON team_subteam_members
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY team_subteam_members_write ON team_subteam_members
  FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

-- Calendar is transparent to the org; leads schedule; creators may edit/delete.
CREATE POLICY subteam_calendar_events_read ON subteam_calendar_events
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY subteam_calendar_events_insert ON subteam_calendar_events
  FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND created_by = current_app_user_id()
    AND (
      has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
      OR subteam_id IS NULL
      OR EXISTS (
        SELECT 1 FROM team_subteam_members sm
        WHERE sm.subteam_id = subteam_calendar_events.subteam_id
          AND sm.user_id = current_app_user_id()
      )
    )
  );
CREATE POLICY subteam_calendar_events_update ON subteam_calendar_events
  FOR UPDATE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  )
  WITH CHECK (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );
CREATE POLICY subteam_calendar_events_delete ON subteam_calendar_events
  FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON
  team_subteams, team_subteam_members, subteam_calendar_events
  TO vantage_app, vantage_worker;
