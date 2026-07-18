-- Season Goals/OKR tracker: team-defined goals for the season with progress derived from
-- real check-ins logged by members (never a fabricated/derived number) — the evidence trail
-- for "are we on track" conversations distinct from the day-to-day task board (0.. tasks).

CREATE TABLE goals_tracker_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('build','competition','business','team','outreach','other')),
  metric_unit text NOT NULL DEFAULT 'percent',
  start_value numeric NOT NULL DEFAULT 0,
  target_value numeric NOT NULL DEFAULT 100 CHECK (target_value <> 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','abandoned')),
  due_on date,
  season_year integer NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goals_tracker_goals_org_season_idx ON goals_tracker_goals(org_id, season_year, status);

CREATE TABLE goals_tracker_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES goals_tracker_goals(id) ON DELETE CASCADE,
  value numeric NOT NULL,
  note text,
  occurred_on date NOT NULL,
  checked_in_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goals_tracker_checkins_org_goal_idx ON goals_tracker_checkins(org_id, goal_id, occurred_on DESC);

ALTER TABLE goals_tracker_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals_tracker_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY goals_tracker_goals_member_read ON goals_tracker_goals FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY goals_tracker_goals_member_insert ON goals_tracker_goals FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY goals_tracker_goals_member_update ON goals_tracker_goals FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY goals_tracker_goals_member_delete ON goals_tracker_goals FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY goals_tracker_checkins_member_read ON goals_tracker_checkins FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY goals_tracker_checkins_member_insert ON goals_tracker_checkins FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND checked_in_by = current_app_user_id());
CREATE POLICY goals_tracker_checkins_member_update ON goals_tracker_checkins FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY goals_tracker_checkins_member_delete ON goals_tracker_checkins FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON goals_tracker_goals TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON goals_tracker_checkins TO vantage_app, vantage_worker;
