-- Mentor Hours & Engagement: the mentor-side activity log that substantiates grant reporting
-- (mentor hours contributed, roles, cadence). Distinct from 0038 `impact_activities` (outreach/
-- STEM community activity) and `hours_self_view` (general member clock-in/out kiosk).

CREATE TABLE mentor_hours_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mentor_name text NOT NULL,
  mentor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'mentor'
    CHECK (role IN ('mentor','professional_mentor','alumni_mentor','parent_volunteer','other')),
  category text NOT NULL DEFAULT 'build'
    CHECK (category IN ('build','strategy','programming','outreach','administration','competition','training','other')),
  occurred_on date NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  season_year integer NOT NULL,
  notes text,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mentor_hours_entries_org_season_idx ON mentor_hours_entries(org_id, season_year, occurred_on DESC);

ALTER TABLE mentor_hours_entries ENABLE ROW LEVEL SECURITY;

-- Any org member may read and manage the shared mentor-hours log; inserts stamp the author.
CREATE POLICY mentor_hours_entries_member_read ON mentor_hours_entries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY mentor_hours_entries_member_insert ON mentor_hours_entries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY mentor_hours_entries_member_update ON mentor_hours_entries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY mentor_hours_entries_member_delete ON mentor_hours_entries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON mentor_hours_entries TO vantage_app, vantage_worker;
