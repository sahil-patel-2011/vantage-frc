-- Opponent Watchlist: a personal (per-member) list of opponent teams to track, with change
-- detection against the shared reference cache (teams_ref / team_event_metrics / matches_ref
-- from 0002_global_reference.sql). Distinct from `epa_trend_alerts_watchlist` (0258), which is an
-- org-shared, single-event watchlist — this is a cross-event, per-member tracker that also
-- watches for schedule (next-match) changes, not just EPA swings.

CREATE TABLE opponent_watchlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  team_key text NOT NULL,
  team_number integer,
  note text,
  notify_schedule boolean NOT NULL DEFAULT true,
  notify_epa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, created_by, team_key)
);
CREATE INDEX opponent_watchlist_entries_org_user_idx
  ON opponent_watchlist_entries(org_id, created_by, created_at DESC);

-- Last-observed EPA/schedule state per watchlist entry, used to diff against the current
-- reference cache each time the view is computed so alerts reflect real, observed changes.
CREATE TABLE opponent_watchlist_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES opponent_watchlist_entries(id) ON DELETE CASCADE,
  team_key text NOT NULL,
  epa_total double precision,
  next_match_key text,
  next_match_time timestamptz,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, entry_id)
);
CREATE INDEX opponent_watchlist_snapshots_org_idx ON opponent_watchlist_snapshots(org_id, team_key);

ALTER TABLE opponent_watchlist_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE opponent_watchlist_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY opponent_watchlist_entries_member_read ON opponent_watchlist_entries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY opponent_watchlist_entries_member_insert ON opponent_watchlist_entries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY opponent_watchlist_entries_member_update ON opponent_watchlist_entries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY opponent_watchlist_entries_member_delete ON opponent_watchlist_entries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY opponent_watchlist_snapshots_member_read ON opponent_watchlist_snapshots FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY opponent_watchlist_snapshots_member_insert ON opponent_watchlist_snapshots FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));
CREATE POLICY opponent_watchlist_snapshots_member_update ON opponent_watchlist_snapshots FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY opponent_watchlist_snapshots_member_delete ON opponent_watchlist_snapshots FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON opponent_watchlist_entries TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON opponent_watchlist_snapshots TO vantage_app, vantage_worker;
