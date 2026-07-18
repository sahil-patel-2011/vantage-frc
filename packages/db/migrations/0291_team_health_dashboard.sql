-- Team Health Dashboard: periodic team-health check-ins (attendance, task throughput,
-- engagement) logged by members so the dashboard can render real trends instead of
-- inferring numbers from other features' live tables.

CREATE TABLE team_health_dashboard_pulses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_label text NOT NULL CHECK (char_length(period_label) BETWEEN 1 AND 60),
  period_start date NOT NULL,
  attendance_rate integer NOT NULL DEFAULT 0 CHECK (attendance_rate BETWEEN 0 AND 100),
  members_present integer NOT NULL DEFAULT 0 CHECK (members_present >= 0),
  members_total integer NOT NULL DEFAULT 0 CHECK (members_total >= 0),
  tasks_completed integer NOT NULL DEFAULT 0 CHECK (tasks_completed >= 0),
  tasks_open integer NOT NULL DEFAULT 0 CHECK (tasks_open >= 0),
  tasks_overdue integer NOT NULL DEFAULT 0 CHECK (tasks_overdue >= 0),
  engagement_score integer NOT NULL DEFAULT 0 CHECK (engagement_score BETWEEN 0 AND 100),
  morale_rating integer NOT NULL DEFAULT 3 CHECK (morale_rating BETWEEN 1 AND 5),
  season_year integer NOT NULL CHECK (season_year BETWEEN 1992 AND 3000),
  notes text,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_health_dashboard_pulses_org_idx
  ON team_health_dashboard_pulses(org_id, period_start DESC);
CREATE INDEX team_health_dashboard_pulses_season_idx
  ON team_health_dashboard_pulses(org_id, season_year, period_start DESC);

ALTER TABLE team_health_dashboard_pulses ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_health_dashboard_pulses_member_read ON team_health_dashboard_pulses
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY team_health_dashboard_pulses_member_insert ON team_health_dashboard_pulses
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY team_health_dashboard_pulses_member_update ON team_health_dashboard_pulses
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY team_health_dashboard_pulses_member_delete ON team_health_dashboard_pulses
  FOR DELETE TO vantage_app USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON team_health_dashboard_pulses TO vantage_app, vantage_worker;
