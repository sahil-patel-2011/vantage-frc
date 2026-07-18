-- Season Rollover: archive a completed season and track the checklist of config/roster/
-- scout-schema items carried forward into the next season year. Distinct from any single
-- feature's own data (roster, scout schemas, config) — this is the cross-cutting rollover
-- ledger a team works through each new season kickoff.

CREATE TABLE season_rollover_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_season_year integer NOT NULL,
  to_season_year integer NOT NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'completed')),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT season_rollover_plans_years_check CHECK (to_season_year > from_season_year)
);
CREATE INDEX season_rollover_plans_org_idx ON season_rollover_plans(org_id, to_season_year DESC, created_at DESC);

ALTER TABLE season_rollover_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY season_rollover_plans_member_read ON season_rollover_plans FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY season_rollover_plans_member_insert ON season_rollover_plans FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY season_rollover_plans_member_update ON season_rollover_plans FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY season_rollover_plans_member_delete ON season_rollover_plans FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON season_rollover_plans TO vantage_app, vantage_worker;

CREATE TABLE season_rollover_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES season_rollover_plans(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('roster', 'scouting_schema', 'config', 'other')),
  label text NOT NULL,
  carried boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  carried_at timestamptz
);
CREATE INDEX season_rollover_items_plan_idx ON season_rollover_items(plan_id, category, created_at);
CREATE INDEX season_rollover_items_org_idx ON season_rollover_items(org_id);

ALTER TABLE season_rollover_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY season_rollover_items_member_read ON season_rollover_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY season_rollover_items_member_insert ON season_rollover_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY season_rollover_items_member_update ON season_rollover_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY season_rollover_items_member_delete ON season_rollover_items FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON season_rollover_items TO vantage_app, vantage_worker;
