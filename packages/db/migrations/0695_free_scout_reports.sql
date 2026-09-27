-- Observations outside an official event must never enter event statistics.
CREATE TABLE free_scout_reports (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scout_user_id uuid NOT NULL REFERENCES users(id),
  year integer NOT NULL CHECK (year BETWEEN 1992 AND 2100),
  type text NOT NULL CHECK (type IN ('match', 'pit')),
  team_number integer NOT NULL CHECK (team_number BETWEEN 1 AND 99999),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  definition jsonb NOT NULL,
  payload jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX free_scout_reports_org_time ON free_scout_reports(org_id, created_at DESC);
ALTER TABLE free_scout_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY free_scout_read ON free_scout_reports FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY free_scout_insert ON free_scout_reports FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND scout_user_id = current_app_user_id());
CREATE POLICY free_scout_delete ON free_scout_reports FOR DELETE TO vantage_app
  USING (is_org_member(org_id) AND (scout_user_id = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])));
GRANT SELECT, INSERT, DELETE ON free_scout_reports TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON free_scout_reports TO vantage_worker;
