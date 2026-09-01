-- Community Impact rows written from a completed outreach-calendar event need a
-- first-class link for idempotency. Completing the same event twice must return
-- the existing impact_activities row, not a duplicate. The description marker
-- `[outreach-calendar:<event-id>]` stays as a fallback for pre-0513 rows.
--
-- Planned/confirmed/canceled events never get a row here — only completed
-- events, and hours still come only from that event's projected numbers.
-- 0502–0512 are reserved; this file is 0513.

ALTER TABLE impact_activities
  ADD COLUMN IF NOT EXISTS source_event_id uuid
    REFERENCES outreach_calendar_events(id) ON DELETE SET NULL;

COMMENT ON COLUMN impact_activities.source_event_id IS
  'outreach_calendar_events.id that produced this row. Unique per org so a second complete is a no-op. NULL for activities logged directly on /impact.';

-- Stamp existing marker-only rows so the unique index can cover them. A
-- duplicate marker keeps source_event_id NULL (ranked) rather than failing the
-- index; the description LIKE fallback still finds those rows.
WITH parsed AS (
  SELECT
    ia.id,
    ia.org_id,
    substring(
      ia.description
      FROM '\[outreach-calendar:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]'
    ) AS event_id_text
  FROM impact_activities ia
  WHERE ia.source_event_id IS NULL
    AND ia.description LIKE '%[outreach-calendar:%'
),
ranked AS (
  SELECT
    p.id,
    e.id AS source_event_id,
    row_number() OVER (PARTITION BY p.org_id, e.id ORDER BY p.id) AS rn
  FROM parsed p
  JOIN outreach_calendar_events e
    ON e.id = p.event_id_text::uuid
   AND e.org_id = p.org_id
  WHERE p.event_id_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
)
UPDATE impact_activities ia
SET source_event_id = r.source_event_id
FROM ranked r
WHERE ia.id = r.id AND r.rn = 1;

CREATE UNIQUE INDEX IF NOT EXISTS impact_activities_org_source_event_uq
  ON impact_activities (org_id, source_event_id)
  WHERE source_event_id IS NOT NULL;
