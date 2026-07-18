-- Build-season burndown: remaining build tasks tracked against the kickoff plan timeline
-- (planned completion date vs actual completion date), so the build lead can see whether
-- the team is ahead of or behind the plan drawn up at kickoff.

CREATE TABLE build_burndown_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('mechanical','electrical','software','drivetrain','autonomous','other')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','done','blocked')),
  planned_date date NOT NULL,
  completed_on date,
  season_year integer NOT NULL,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX build_burndown_tasks_org_season_idx ON build_burndown_tasks(org_id, season_year, planned_date);

ALTER TABLE build_burndown_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY build_burndown_tasks_member_read ON build_burndown_tasks FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY build_burndown_tasks_member_insert ON build_burndown_tasks FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY build_burndown_tasks_member_update ON build_burndown_tasks FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY build_burndown_tasks_member_delete ON build_burndown_tasks FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON build_burndown_tasks TO vantage_app, vantage_worker;

-- Kickoff plan: the season's build-window boundaries used to draw the ideal burndown line.
CREATE TABLE build_burndown_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  kickoff_date date NOT NULL,
  competition_date date NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year)
);

ALTER TABLE build_burndown_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY build_burndown_plans_member_read ON build_burndown_plans FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY build_burndown_plans_member_insert ON build_burndown_plans FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY build_burndown_plans_member_update ON build_burndown_plans FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY build_burndown_plans_member_delete ON build_burndown_plans FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON build_burndown_plans TO vantage_app, vantage_worker;
