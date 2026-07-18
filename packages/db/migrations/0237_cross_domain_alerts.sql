-- Cross-domain awareness: log CAD/subsystem changes and let the app cross-reference them
-- against open design reviews (0118_design_reviews.sql) and software/firmware versions
-- (0097_software_versions.sql) to flag conflicts — e.g. a CAD change lands on a subsystem
-- with an open design review, or an installed component drifts from its target version.
-- Alerts themselves are computed at read time from these logs plus the existing tables
-- above; this migration only adds the change log and an acknowledgement/dismissal record.

CREATE TABLE cross_domain_alerts_subsystem_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  subsystem text NOT NULL,
  domain text NOT NULL DEFAULT 'cad'
    CHECK (domain IN ('cad', 'firmware', 'software', 'mechanical', 'electrical', 'other')),
  title text NOT NULL,
  description text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'cad_job')),
  source_ref text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cross_domain_alerts_subsystem_events_org_season_idx
  ON cross_domain_alerts_subsystem_events(org_id, season_year, occurred_at DESC);

ALTER TABLE cross_domain_alerts_subsystem_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY cross_domain_alerts_subsystem_events_member_read ON cross_domain_alerts_subsystem_events
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY cross_domain_alerts_subsystem_events_member_insert ON cross_domain_alerts_subsystem_events
  FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY cross_domain_alerts_subsystem_events_member_update ON cross_domain_alerts_subsystem_events
  FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY cross_domain_alerts_subsystem_events_member_delete ON cross_domain_alerts_subsystem_events
  FOR DELETE TO vantage_app USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON cross_domain_alerts_subsystem_events TO vantage_app, vantage_worker;

CREATE TABLE cross_domain_alerts_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  alert_key text NOT NULL,
  note text,
  acknowledged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year, alert_key)
);
CREATE INDEX cross_domain_alerts_acks_org_season_idx
  ON cross_domain_alerts_acks(org_id, season_year);

ALTER TABLE cross_domain_alerts_acks ENABLE ROW LEVEL SECURITY;

CREATE POLICY cross_domain_alerts_acks_member_read ON cross_domain_alerts_acks
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY cross_domain_alerts_acks_member_insert ON cross_domain_alerts_acks
  FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND acknowledged_by = current_app_user_id());
CREATE POLICY cross_domain_alerts_acks_member_update ON cross_domain_alerts_acks
  FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY cross_domain_alerts_acks_member_delete ON cross_domain_alerts_acks
  FOR DELETE TO vantage_app USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON cross_domain_alerts_acks TO vantage_app, vantage_worker;
