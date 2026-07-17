-- App-readable TBA cache freshness (sync_cursors remains worker-private).
CREATE OR REPLACE VIEW tba_cache_freshness AS
SELECT
  'tba'::text AS source,
  (
    SELECT max(synced_at)
    FROM (
      SELECT synced_at FROM events_ref
      UNION ALL
      SELECT synced_at FROM matches_ref
      UNION ALL
      SELECT synced_at FROM team_event_metrics
    ) AS stamps
  ) AS synced_at,
  (
    SELECT status FROM data_source_health WHERE source = 'tba' LIMIT 1
  ) AS health_status,
  (
    SELECT details->>'error'
    FROM data_source_health
    WHERE source = 'tba'
    LIMIT 1
  ) AS last_error,
  (
    SELECT last_success_at FROM data_source_health WHERE source = 'tba' LIMIT 1
  ) AS last_success_at,
  now() AS observed_at;

GRANT SELECT ON tba_cache_freshness TO vantage_app, vantage_worker;
