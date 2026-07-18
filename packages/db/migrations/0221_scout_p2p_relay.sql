-- Scout P2P Relay: local device-to-device scout-entry sync (BroadcastChannel/WebRTC happens
-- client-side, in the browser, between tablets on the same pit network). These tables are the
-- server-side audit trail of relay sessions and per-device merge contributions once the captain
-- tablet aggregates local scout entries and uplinks the merged batch to Vantage.

CREATE TABLE scout_p2p_relay_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  season_year integer NOT NULL,
  captain_device_label text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','synced','closed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scout_p2p_relay_sessions_org_season_idx
  ON scout_p2p_relay_sessions(org_id, season_year, started_at DESC);

CREATE TABLE scout_p2p_relay_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES scout_p2p_relay_sessions(id) ON DELETE CASCADE,
  device_label text NOT NULL,
  device_role text NOT NULL DEFAULT 'scout' CHECK (device_role IN ('scout','captain')),
  entries_contributed integer NOT NULL DEFAULT 0 CHECK (entries_contributed >= 0),
  conflicts_resolved integer NOT NULL DEFAULT 0 CHECK (conflicts_resolved >= 0),
  uplinked boolean NOT NULL DEFAULT false,
  merged_at timestamptz NOT NULL DEFAULT now(),
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scout_p2p_relay_entries_org_session_idx
  ON scout_p2p_relay_entries(org_id, session_id, merged_at DESC);

ALTER TABLE scout_p2p_relay_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_p2p_relay_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_p2p_relay_sessions_member_read ON scout_p2p_relay_sessions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_p2p_relay_sessions_member_insert ON scout_p2p_relay_sessions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY scout_p2p_relay_sessions_member_update ON scout_p2p_relay_sessions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_p2p_relay_sessions_member_delete ON scout_p2p_relay_sessions FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY scout_p2p_relay_entries_member_read ON scout_p2p_relay_entries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_p2p_relay_entries_member_insert ON scout_p2p_relay_entries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY scout_p2p_relay_entries_member_update ON scout_p2p_relay_entries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_p2p_relay_entries_member_delete ON scout_p2p_relay_entries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_p2p_relay_sessions TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON scout_p2p_relay_entries TO vantage_app, vantage_worker;
