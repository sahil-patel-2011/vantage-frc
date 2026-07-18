-- Live match-delta watcher: watches official match results (matches_ref) as they land against
-- our prediction model (predictions) and pick-list priorities (pick_lists / pick_list_entries),
-- and persists alerts when reality diverges. One config row per org+event; alerts are upserted
-- idempotently per (org, match, alert type) so repeated cron scans don't duplicate rows.

CREATE TABLE match_delta_watcher_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  upset_threshold double precision NOT NULL DEFAULT 0.65 CHECK (upset_threshold > 0.5 AND upset_threshold <= 1),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_key)
);

CREATE TABLE match_delta_watcher_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key) ON DELETE CASCADE,
  match_key text NOT NULL REFERENCES matches_ref(match_key) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN ('winner_mismatch', 'pick_list_upset', 'margin_surprise')),
  severity text NOT NULL DEFAULT 'watch' CHECK (severity IN ('info', 'watch', 'critical')),
  predicted_winner text CHECK (predicted_winner IN ('red', 'blue', 'tie')),
  actual_winner text CHECK (actual_winner IN ('red', 'blue', 'tie')),
  predicted_probability double precision,
  summary text NOT NULL,
  teams_involved text[] NOT NULL DEFAULT '{}',
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_by uuid REFERENCES users(id),
  acknowledged_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, match_key, alert_type)
);
CREATE INDEX match_delta_watcher_alerts_org_event_idx
  ON match_delta_watcher_alerts(org_id, event_key, created_at DESC);

ALTER TABLE match_delta_watcher_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_delta_watcher_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_delta_watcher_configs_member_read ON match_delta_watcher_configs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY match_delta_watcher_configs_member_insert ON match_delta_watcher_configs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY match_delta_watcher_configs_member_update ON match_delta_watcher_configs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY match_delta_watcher_configs_member_delete ON match_delta_watcher_configs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY match_delta_watcher_alerts_member_read ON match_delta_watcher_alerts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY match_delta_watcher_alerts_member_insert ON match_delta_watcher_alerts FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY match_delta_watcher_alerts_member_update ON match_delta_watcher_alerts FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY match_delta_watcher_alerts_member_delete ON match_delta_watcher_alerts FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON match_delta_watcher_configs, match_delta_watcher_alerts
  TO vantage_app, vantage_worker;
