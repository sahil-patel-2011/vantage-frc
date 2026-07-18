-- Season Report: end-of-season state-of-the-team retrospective. Teams log dated notes/metrics
-- across build reliability, results, budget, outreach, and lessons; the generator synthesizes a
-- deterministic narrative snapshot from only what was logged (no invented numbers). Two new
-- tables: the entry log and the generated-snapshot history.

CREATE TABLE season_report_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  category text NOT NULL DEFAULT 'lessons'
    CHECK (category IN ('build_reliability', 'results', 'budget', 'outreach', 'lessons')),
  title text NOT NULL,
  detail text,
  metric_label text,
  metric_value numeric(12, 2),
  sentiment text NOT NULL DEFAULT 'neutral' CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX season_report_entries_org_season_idx
  ON season_report_entries(org_id, season_year, category, created_at DESC);

ALTER TABLE season_report_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY season_report_entries_member_read ON season_report_entries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY season_report_entries_member_insert ON season_report_entries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY season_report_entries_member_update ON season_report_entries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY season_report_entries_member_delete ON season_report_entries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON season_report_entries TO vantage_app, vantage_worker;

CREATE TABLE season_report_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  completeness numeric(4, 3) NOT NULL DEFAULT 0 CHECK (completeness >= 0 AND completeness <= 1),
  narrative jsonb NOT NULL DEFAULT '{}'::jsonb,
  highlights text[] NOT NULL DEFAULT '{}',
  watchouts text[] NOT NULL DEFAULT '{}',
  entry_count integer NOT NULL DEFAULT 0 CHECK (entry_count >= 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX season_report_snapshots_org_season_idx
  ON season_report_snapshots(org_id, season_year, created_at DESC);

ALTER TABLE season_report_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY season_report_snapshots_member_read ON season_report_snapshots FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY season_report_snapshots_member_insert ON season_report_snapshots FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY season_report_snapshots_member_update ON season_report_snapshots FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY season_report_snapshots_member_delete ON season_report_snapshots FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON season_report_snapshots TO vantage_app, vantage_worker;
