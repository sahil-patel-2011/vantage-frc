-- Coverage-gap live dashboard: per-org thresholds for "thin" scouting coverage, plus a log of
-- push nudges sent to the scout coordinator mid-event when a match/team combo is under-scouted.
-- The coverage grid itself is computed on read from matches_ref + match_scout_entries (0002/0003);
-- these tables hold only the org's own configuration and nudge history.

CREATE TABLE scout_coverage_live_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  thin_threshold integer NOT NULL DEFAULT 2 CHECK (thin_threshold > 0),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

CREATE TABLE scout_coverage_live_nudges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  match_key text NOT NULL,
  team_key text NOT NULL,
  message text NOT NULL,
  sent_by uuid NOT NULL REFERENCES users(id),
  sent_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES users(id),
  acknowledged_at timestamptz
);
CREATE INDEX scout_coverage_live_nudges_org_event_idx
  ON scout_coverage_live_nudges(org_id, event_key, sent_at DESC);

ALTER TABLE scout_coverage_live_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_coverage_live_nudges ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_coverage_live_settings_member_read ON scout_coverage_live_settings FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_coverage_live_settings_member_insert ON scout_coverage_live_settings FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND updated_by = current_app_user_id());
CREATE POLICY scout_coverage_live_settings_member_update ON scout_coverage_live_settings FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_coverage_live_settings_member_delete ON scout_coverage_live_settings FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY scout_coverage_live_nudges_member_read ON scout_coverage_live_nudges FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_coverage_live_nudges_member_insert ON scout_coverage_live_nudges FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND sent_by = current_app_user_id());
CREATE POLICY scout_coverage_live_nudges_member_update ON scout_coverage_live_nudges FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_coverage_live_nudges_member_delete ON scout_coverage_live_nudges FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_coverage_live_settings, scout_coverage_live_nudges
  TO vantage_app, vantage_worker;
