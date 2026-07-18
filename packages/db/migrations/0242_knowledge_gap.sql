-- Knowledge-gap detective: scans the wiki/decision corpus against real subsystems
-- (robot_subsystems) and real events the team has actually scouted (distinct event_key
-- rows in match_scout_entries) and lists undocumented subjects. Stub pages are drafted
-- directly into the existing knowledge_pages wiki (0149_team_wiki.sql) so a gap becomes
-- a real editable page, not a fabricated record.

CREATE TABLE knowledge_gap_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  subsystem_count integer NOT NULL DEFAULT 0 CHECK (subsystem_count >= 0),
  decision_count integer NOT NULL DEFAULT 0 CHECK (decision_count >= 0),
  event_count integer NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  page_count integer NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  gap_count integer NOT NULL DEFAULT 0 CHECK (gap_count >= 0),
  coverage_score numeric(5, 4) NOT NULL DEFAULT 1 CHECK (coverage_score BETWEEN 0 AND 1),
  summary text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_gap_scans_org_season_idx ON knowledge_gap_scans(org_id, season_year, created_at DESC);

CREATE TABLE knowledge_gap_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scan_id uuid NOT NULL REFERENCES knowledge_gap_scans(id) ON DELETE CASCADE,
  subject_kind text NOT NULL CHECK (subject_kind IN ('subsystem', 'decision', 'event')),
  subject_ref text NOT NULL,
  subject_id text,
  season_year integer NOT NULL,
  reason text NOT NULL,
  suggested_template text NOT NULL DEFAULT 'blank',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'drafted', 'dismissed')),
  draft_page_id uuid REFERENCES knowledge_pages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_gap_items_scan_idx ON knowledge_gap_items(scan_id, status);
CREATE INDEX knowledge_gap_items_org_season_idx ON knowledge_gap_items(org_id, season_year, status);

ALTER TABLE knowledge_gap_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_gap_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_gap_scans_member_read ON knowledge_gap_scans FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY knowledge_gap_scans_member_insert ON knowledge_gap_scans FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY knowledge_gap_scans_member_update ON knowledge_gap_scans FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY knowledge_gap_scans_member_delete ON knowledge_gap_scans FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY knowledge_gap_items_member_read ON knowledge_gap_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY knowledge_gap_items_member_insert ON knowledge_gap_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));
CREATE POLICY knowledge_gap_items_member_update ON knowledge_gap_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY knowledge_gap_items_member_delete ON knowledge_gap_items FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_gap_scans, knowledge_gap_items TO vantage_app, vantage_worker;
