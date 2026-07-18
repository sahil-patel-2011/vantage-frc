-- EPA trend alerts: watchlist teams you might face at an event and surface meaningful
-- EPA up/down swings. The EPA numbers themselves live in the shared reference cache
-- (0002_global_reference.sql team_event_metrics); this feature only stores which teams an
-- org is watching and which computed alerts they have dismissed.

CREATE TABLE epa_trend_alerts_watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_key text NOT NULL,
  team_number integer,
  note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, team_key)
);
CREATE INDEX epa_trend_alerts_watchlist_org_idx ON epa_trend_alerts_watchlist(org_id, created_at DESC);

CREATE TABLE epa_trend_alerts_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_key text NOT NULL,
  alert_fingerprint text NOT NULL,
  dismissed_by uuid NOT NULL REFERENCES users(id),
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, team_key, alert_fingerprint)
);
CREATE INDEX epa_trend_alerts_dismissals_org_idx ON epa_trend_alerts_dismissals(org_id, team_key);

ALTER TABLE epa_trend_alerts_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE epa_trend_alerts_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY epa_trend_alerts_watchlist_member_read ON epa_trend_alerts_watchlist FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY epa_trend_alerts_watchlist_member_insert ON epa_trend_alerts_watchlist FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY epa_trend_alerts_watchlist_member_update ON epa_trend_alerts_watchlist FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY epa_trend_alerts_watchlist_member_delete ON epa_trend_alerts_watchlist FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY epa_trend_alerts_dismissals_member_read ON epa_trend_alerts_dismissals FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY epa_trend_alerts_dismissals_member_insert ON epa_trend_alerts_dismissals FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND dismissed_by = current_app_user_id());
CREATE POLICY epa_trend_alerts_dismissals_member_update ON epa_trend_alerts_dismissals FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY epa_trend_alerts_dismissals_member_delete ON epa_trend_alerts_dismissals FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON epa_trend_alerts_watchlist TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON epa_trend_alerts_dismissals TO vantage_app, vantage_worker;
