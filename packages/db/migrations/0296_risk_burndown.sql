-- Season risk-register burndown & mitigation tracker: the shared log of season risks
-- (technical, schedule, budget, personnel, logistics, safety) with likelihood/impact scoring,
-- mitigation plans, and close-out dates so the team can watch open risk burn down over the season.

CREATE TABLE risk_burndown_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('technical','schedule','budget','personnel','logistics','safety','other')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','mitigating','closed','accepted')),
  likelihood integer NOT NULL DEFAULT 3 CHECK (likelihood BETWEEN 1 AND 5),
  impact integer NOT NULL DEFAULT 3 CHECK (impact BETWEEN 1 AND 5),
  owner_name text,
  mitigation_plan text,
  identified_on date NOT NULL,
  target_close_date date,
  closed_on date,
  season_year integer NOT NULL,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX risk_burndown_items_org_season_idx ON risk_burndown_items(org_id, season_year, identified_on DESC);

ALTER TABLE risk_burndown_items ENABLE ROW LEVEL SECURITY;

-- Any org member may read and manage the shared risk register; inserts stamp the author.
CREATE POLICY risk_burndown_items_member_read ON risk_burndown_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY risk_burndown_items_member_insert ON risk_burndown_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY risk_burndown_items_member_update ON risk_burndown_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY risk_burndown_items_member_delete ON risk_burndown_items FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON risk_burndown_items TO vantage_app, vantage_worker;
