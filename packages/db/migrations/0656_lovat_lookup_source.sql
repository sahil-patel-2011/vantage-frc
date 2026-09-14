-- Lovat Team Lookup notes + Dashboard data-source picker (own / all / selected).

CREATE TABLE team_lookup_notes (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_key text NOT NULL,
  body text NOT NULL DEFAULT '',
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, team_key)
);
CREATE INDEX team_lookup_notes_org_updated_idx ON team_lookup_notes (org_id, updated_at DESC);

ALTER TABLE team_lookup_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_lookup_notes_member_read ON team_lookup_notes
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY team_lookup_notes_lead_write ON team_lookup_notes
  FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON team_lookup_notes TO vantage_app, vantage_worker;

CREATE TABLE org_analytics_source (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'all'
    CHECK (mode IN ('own', 'all', 'selected')),
  team_keys text[] NOT NULL DEFAULT '{}',
  event_keys text[] NOT NULL DEFAULT '{}',
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE org_analytics_source ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_analytics_source_member_read ON org_analytics_source
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY org_analytics_source_lead_write ON org_analytics_source
  FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON org_analytics_source TO vantage_app, vantage_worker;
