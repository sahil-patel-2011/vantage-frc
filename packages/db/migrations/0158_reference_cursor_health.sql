-- App-readable ETag/cursor summary for TBA + Statbotics without exposing sync_cursors rows.
-- Strategy and Team → Data use this with data_source_health to show "data source degraded"
-- while continuing to serve last-known-good Neon reference cache.

CREATE OR REPLACE FUNCTION app_reference_cursor_summary()
RETURNS TABLE (
  source text,
  resources_tracked integer,
  resources_with_etag integer,
  resources_with_error integer,
  last_synced_at timestamptz,
  last_error text,
  last_status integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.source,
    count(*)::integer AS resources_tracked,
    count(*) FILTER (WHERE c.etag IS NOT NULL)::integer AS resources_with_etag,
    count(*) FILTER (WHERE c.last_error IS NOT NULL)::integer AS resources_with_error,
    max(c.synced_at) AS last_synced_at,
    (
      array_agg(c.last_error ORDER BY c.updated_at DESC NULLS LAST)
      FILTER (WHERE c.last_error IS NOT NULL)
    )[1] AS last_error,
    (
      array_agg(c.last_status ORDER BY c.updated_at DESC NULLS LAST)
      FILTER (WHERE c.last_status IS NOT NULL)
    )[1] AS last_status
  FROM sync_cursors c
  WHERE c.source IN ('tba', 'statbotics')
  GROUP BY c.source;
$$;

REVOKE ALL ON FUNCTION app_reference_cursor_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_reference_cursor_summary() TO vantage_app, vantage_worker;

-- 0034 already shipped this view with `observed_at` in sixth position. CREATE OR
-- REPLACE VIEW can only append columns, so replacing it in place fails with
-- `cannot change name of view column "observed_at"`. Drop and recreate instead;
-- nothing in the database depends on the view (only apps/web/lib/reference-health.ts
-- selects from it).
DROP VIEW IF EXISTS tba_cache_freshness;

CREATE VIEW tba_cache_freshness AS
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
  (
    SELECT resources_with_etag FROM app_reference_cursor_summary() WHERE source = 'tba' LIMIT 1
  ) AS etag_resources,
  (
    SELECT resources_with_error FROM app_reference_cursor_summary() WHERE source = 'tba' LIMIT 1
  ) AS errored_resources,
  (
    SELECT last_status FROM app_reference_cursor_summary() WHERE source = 'tba' LIMIT 1
  ) AS last_http_status,
  now() AS observed_at;

GRANT SELECT ON tba_cache_freshness TO vantage_app, vantage_worker;
