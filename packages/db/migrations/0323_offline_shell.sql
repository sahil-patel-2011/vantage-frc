-- Offline Shell: records of service-worker precache builds/syncs for the offline-capable
-- app shell (scouting/schedule routes usable cold, no-signal). Distinct from any live
-- scouting-submission sync queue — this tracks shell CACHE READINESS, not scouting data.
-- Idempotent: safe if a parallel agent already applied an earlier draft.

CREATE TABLE IF NOT EXISTS offline_shell_cache_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_label text NOT NULL,
  routes text[] NOT NULL DEFAULT '{}',
  route_count integer NOT NULL DEFAULT 0 CHECK (route_count >= 0),
  cache_bytes bigint NOT NULL DEFAULT 0 CHECK (cache_bytes >= 0),
  network_status text NOT NULL DEFAULT 'online'
    CHECK (network_status IN ('online','offline','degraded')),
  notes text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offline_shell_cache_events_org_occurred_idx
  ON offline_shell_cache_events(org_id, occurred_at DESC);

ALTER TABLE offline_shell_cache_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offline_shell_cache_events_member_read ON offline_shell_cache_events;
DROP POLICY IF EXISTS offline_shell_cache_events_member_insert ON offline_shell_cache_events;
DROP POLICY IF EXISTS offline_shell_cache_events_member_update ON offline_shell_cache_events;
DROP POLICY IF EXISTS offline_shell_cache_events_member_delete ON offline_shell_cache_events;

-- Any org member may read and manage the shared offline-shell cache log; inserts stamp the author.
CREATE POLICY offline_shell_cache_events_member_read ON offline_shell_cache_events FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY offline_shell_cache_events_member_insert ON offline_shell_cache_events FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY offline_shell_cache_events_member_update ON offline_shell_cache_events FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY offline_shell_cache_events_member_delete ON offline_shell_cache_events FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON offline_shell_cache_events TO vantage_app, vantage_worker;
