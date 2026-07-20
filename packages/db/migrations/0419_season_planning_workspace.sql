-- Season Planning Workspace: goals → milestones → owners with calendar sync hooks and
-- progress grounded in real attendance_events / build_tasks for the season — never fabricated
-- completion %. Distinct from goals_tracker (metric check-ins) and build_tasks (kanban alone).

CREATE TABLE season_planning_workspace_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 1992 AND 3000),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year, title)
);
CREATE INDEX season_planning_workspace_plans_org_season_idx
  ON season_planning_workspace_plans(org_id, season_year, updated_at DESC);

CREATE TABLE season_planning_workspace_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES season_planning_workspace_plans(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  category text NOT NULL DEFAULT 'build'
    CHECK (category IN ('build', 'competition', 'outreach', 'business', 'ops', 'other')),
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_date date,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'done', 'dropped')),
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX season_planning_workspace_goals_plan_idx
  ON season_planning_workspace_goals(org_id, plan_id, sort_order, created_at);

CREATE TABLE season_planning_workspace_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES season_planning_workspace_plans(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES season_planning_workspace_goals(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  due_on date,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'done', 'dropped')),
  -- Opaque calendar UID for ICS / Google Calendar sync hooks (client-generated stable id).
  calendar_event_uid text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX season_planning_workspace_milestones_goal_idx
  ON season_planning_workspace_milestones(org_id, goal_id, sort_order, due_on);
CREATE INDEX season_planning_workspace_milestones_calendar_idx
  ON season_planning_workspace_milestones(org_id, calendar_event_uid)
  WHERE calendar_event_uid IS NOT NULL;

ALTER TABLE season_planning_workspace_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_planning_workspace_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_planning_workspace_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY season_planning_workspace_plans_member_read ON season_planning_workspace_plans
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY season_planning_workspace_plans_member_insert ON season_planning_workspace_plans
  FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY season_planning_workspace_plans_member_update ON season_planning_workspace_plans
  FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY season_planning_workspace_plans_member_delete ON season_planning_workspace_plans
  FOR DELETE TO vantage_app USING (is_org_member(org_id));

CREATE POLICY season_planning_workspace_goals_member_read ON season_planning_workspace_goals
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY season_planning_workspace_goals_member_insert ON season_planning_workspace_goals
  FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY season_planning_workspace_goals_member_update ON season_planning_workspace_goals
  FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY season_planning_workspace_goals_member_delete ON season_planning_workspace_goals
  FOR DELETE TO vantage_app USING (is_org_member(org_id));

CREATE POLICY season_planning_workspace_milestones_member_read ON season_planning_workspace_milestones
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY season_planning_workspace_milestones_member_insert ON season_planning_workspace_milestones
  FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY season_planning_workspace_milestones_member_update ON season_planning_workspace_milestones
  FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY season_planning_workspace_milestones_member_delete ON season_planning_workspace_milestones
  FOR DELETE TO vantage_app USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON season_planning_workspace_plans TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON season_planning_workspace_goals TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON season_planning_workspace_milestones TO vantage_app, vantage_worker;
