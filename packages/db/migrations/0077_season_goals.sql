-- Season Goals & Objectives: the measurable objectives that define a successful season
-- (competition, technical, outreach, business, team) with target vs current progress. The app
-- derives per-goal status and a priority-weighted scorecard. Org-scoped, collaborative, RLS.

CREATE TABLE season_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('competition','technical','outreach','business','team','other')),
  metric_type text NOT NULL DEFAULT 'count'
    CHECK (metric_type IN ('percent','count','currency','binary')),
  target_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (target_value >= 0),
  current_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (current_value >= 0),
  unit text,
  due_on date,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX season_goals_org_season_idx ON season_goals(org_id, season_year);

ALTER TABLE season_goals ENABLE ROW LEVEL SECURITY;

-- Any org member may read and manage the shared goal set; rows stamp the author on insert.
CREATE POLICY season_goals_member_read ON season_goals FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY season_goals_member_insert ON season_goals FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY season_goals_member_update ON season_goals FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY season_goals_member_delete ON season_goals FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON season_goals TO vantage_app, vantage_worker;
