-- Qualitative pairwise ranking (Pairwise-style) for FRC driver skill, defense,
-- field awareness, and custom criteria. Org-scoped; no DEMO teams or ranks.

CREATE TABLE qualitative_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 2000 AND 3000),
  slug text NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year, slug),
  CONSTRAINT qualitative_criteria_slug_chk CHECK (slug ~ '^[a-z][a-z0-9_]{1,40}$')
);
CREATE INDEX qualitative_criteria_org_season_idx
  ON qualitative_criteria (org_id, season_year, sort_order);

CREATE TABLE pairwise_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 2000 AND 3000),
  criterion_id uuid NOT NULL REFERENCES qualitative_criteria(id) ON DELETE CASCADE,
  winner_team_number integer NOT NULL CHECK (winner_team_number BETWEEN 1 AND 99999),
  loser_team_number integer NOT NULL CHECK (loser_team_number BETWEEN 1 AND 99999),
  event_key text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pairwise_comparisons_distinct_chk CHECK (winner_team_number <> loser_team_number)
);
CREATE INDEX pairwise_comparisons_org_criterion_idx
  ON pairwise_comparisons (org_id, criterion_id, created_at DESC);

ALTER TABLE qualitative_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairwise_comparisons ENABLE ROW LEVEL SECURITY;

CREATE POLICY qualitative_criteria_member_read ON qualitative_criteria
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY qualitative_criteria_member_insert ON qualitative_criteria
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY qualitative_criteria_admin_write ON qualitative_criteria
  FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY pairwise_comparisons_member_read ON pairwise_comparisons
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY pairwise_comparisons_member_insert ON pairwise_comparisons
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY pairwise_comparisons_self_delete ON pairwise_comparisons
  FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id());
CREATE POLICY pairwise_comparisons_admin_write ON pairwise_comparisons
  FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON qualitative_criteria, pairwise_comparisons
  TO vantage_app, vantage_worker;
