-- Build Hours (Cheesy Hours-style shop-time tracking).
-- Clock-in/clock-out logs per member with a season hour goal, powering
-- who's-in-the-shop-now, per-member hour totals, and a season leaderboard.
-- Many programs require a minimum of logged build hours for travel eligibility.
-- Distinct from the meeting-attendance module (attendance_events/entries):
-- that tracks who attended which meeting; this accumulates shop time.

CREATE TABLE hour_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'build' CHECK (kind IN ('build', 'meeting', 'outreach', 'competition', 'other')),
  clock_in timestamptz NOT NULL DEFAULT now(),
  clock_out timestamptz CHECK (clock_out IS NULL OR clock_out > clock_in),
  note text NOT NULL DEFAULT '',
  -- Who created/closed the log: the member themself or a mentor/admin sweep.
  created_by uuid NOT NULL REFERENCES users(id),
  closed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hour_logs_org_idx ON hour_logs(org_id, clock_in DESC);
CREATE INDEX hour_logs_user_idx ON hour_logs(org_id, user_id, clock_in DESC);
-- At most one open (un-clocked-out) session per member per org.
CREATE UNIQUE INDEX hour_logs_open_unique ON hour_logs(org_id, user_id) WHERE clock_out IS NULL;

CREATE TABLE hour_policies (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  season_goal_hours numeric(7, 2) NOT NULL DEFAULT 0 CHECK (season_goal_hours >= 0),
  season_start date,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hour_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hour_policies ENABLE ROW LEVEL SECURITY;

-- Leaderboards are team-visible: every member reads all org logs. Members insert
-- their own; edits/closures allowed to the member or an owner/admin (the API
-- further restricts which fields non-admins may change).
CREATE POLICY hour_logs_read ON hour_logs FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY hour_logs_insert ON hour_logs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY hour_logs_update ON hour_logs FOR UPDATE TO vantage_app
  USING (user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (is_org_member(org_id));
CREATE POLICY hour_logs_delete ON hour_logs FOR DELETE TO vantage_app
  USING (user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY hour_policy_read ON hour_policies FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY hour_policy_write ON hour_policies FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON hour_logs, hour_policies TO vantage_app, vantage_worker;
