-- Recurring calendar events (RFC 5545 subset) + exceptions.
--
-- A build season is "Tuesday and Thursday 6-9pm plus Saturday 10-4" for fourteen
-- weeks. Before this migration a mentor had to hand-create ~50 rows, which made
-- the calendar unusable as a replacement for whatever the team already runs on.
--
-- Model:
--   * A *series master* is a normal subteam_calendar_events row with rrule set
--     and series_id = its own id. Its starts_at is DTSTART; occurrences are
--     expanded at read time (apps/web/lib/calendar/recurrence.ts) — occurrences
--     are never materialized in bulk.
--   * A *detached occurrence* is a real row with series_id = the master's id and
--     rrule NULL. It exists when someone edits or moves one occurrence, or RSVPs
--     to one (RSVPs need a real event id).
--   * calendar_event_exceptions records what happened to a given occurrence of a
--     series: 'skipped' (no meeting the week of Thanksgiving), 'moved' /
--     'edited' (this Tuesday we start at 5) with the detached row that replaces
--     it. Occurrence identity is the ORIGINAL occurrence start instant.
--
-- Recurrence is wall-clock in recurrence_timezone, so a 6pm Tuesday meeting stays
-- 6pm local across the November DST change.

ALTER TABLE subteam_calendar_events
  ADD COLUMN IF NOT EXISTS rrule text,
  ADD COLUMN IF NOT EXISTS recurrence_end date,
  ADD COLUMN IF NOT EXISTS series_id uuid,
  ADD COLUMN IF NOT EXISTS recurrence_timezone text NOT NULL DEFAULT 'UTC';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subteam_calendar_events_rrule_len'
  ) THEN
    ALTER TABLE subteam_calendar_events
      ADD CONSTRAINT subteam_calendar_events_rrule_len
      CHECK (rrule IS NULL OR char_length(rrule) BETWEEN 8 AND 400);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subteam_calendar_events_tz_shape'
  ) THEN
    ALTER TABLE subteam_calendar_events
      ADD CONSTRAINT subteam_calendar_events_tz_shape
      CHECK (recurrence_timezone ~ '^[A-Za-z0-9_+/-]{1,64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subteam_calendar_events_series_fk'
  ) THEN
    ALTER TABLE subteam_calendar_events
      ADD CONSTRAINT subteam_calendar_events_series_fk
      FOREIGN KEY (series_id) REFERENCES subteam_calendar_events(id) ON DELETE CASCADE;
  END IF;
END
$$;

-- Series lookups (expansion + "this and following" splits).
CREATE INDEX IF NOT EXISTS subteam_calendar_events_series_idx
  ON subteam_calendar_events(org_id, series_id)
  WHERE series_id IS NOT NULL;

-- Recurring rows must stay visible even when DTSTART is far in the past.
CREATE INDEX IF NOT EXISTS subteam_calendar_events_recurring_idx
  ON subteam_calendar_events(org_id, recurrence_end)
  WHERE rrule IS NOT NULL;

CREATE TABLE IF NOT EXISTS calendar_event_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The series master row this exception belongs to.
  series_id uuid NOT NULL REFERENCES subteam_calendar_events(id) ON DELETE CASCADE,
  -- The ORIGINAL start instant of the occurrence being excepted (RECURRENCE-ID).
  occurrence_date timestamptz NOT NULL,
  action text NOT NULL CHECK (action IN ('skipped', 'moved', 'edited')),
  -- Free-form record of what changed, for audit/debug. Never the source of truth:
  -- 'moved'/'edited' occurrences are read from their detached row.
  override jsonb NOT NULL DEFAULT '{}'::jsonb,
  detached_event_id uuid REFERENCES subteam_calendar_events(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (series_id, occurrence_date),
  CONSTRAINT calendar_event_exceptions_detached_shape CHECK (
    (action = 'skipped' AND detached_event_id IS NULL)
    OR (action <> 'skipped')
  )
);

CREATE INDEX IF NOT EXISTS calendar_event_exceptions_org_idx
  ON calendar_event_exceptions(org_id, series_id, occurrence_date);

ALTER TABLE calendar_event_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_event_exceptions_read ON calendar_event_exceptions;
DROP POLICY IF EXISTS calendar_event_exceptions_write ON calendar_event_exceptions;

-- Same transparency model as the calendar itself: the whole org reads; the
-- series creator and owners/admins change it.
CREATE POLICY calendar_event_exceptions_read ON calendar_event_exceptions
  FOR SELECT TO vantage_app USING (is_org_member(org_id));

CREATE POLICY calendar_event_exceptions_write ON calendar_event_exceptions
  FOR ALL TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
      OR EXISTS (
        SELECT 1 FROM subteam_calendar_events e
        WHERE e.id = calendar_event_exceptions.series_id
          AND e.created_by = current_app_user_id()
      )
    )
  )
  WITH CHECK (
    is_org_member(org_id)
    AND created_by = current_app_user_id()
    AND (
      has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
      OR EXISTS (
        SELECT 1 FROM subteam_calendar_events e
        WHERE e.id = calendar_event_exceptions.series_id
          AND e.created_by = current_app_user_id()
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_event_exceptions TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------------------
-- Subscribe feed: emit real RRULE lines, not expanded copies.
--
-- Replaces get_calendar_feed from 0144 with the same security model (SECURITY
-- DEFINER, token-scoped, NULL for unknown tokens or members who left the org) and
-- the same scope rules. Additions: rrule / recurrenceEnd / timeZone / exdates on
-- series rows, recurrenceId + seriesUid on detached rows, and a window predicate
-- that keeps a long-running series whose DTSTART is old.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_calendar_feed(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tok calendar_feed_tokens%ROWTYPE;
  result jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 OR length(p_token) > 100 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO tok FROM calendar_feed_tokens WHERE token = p_token;
  IF tok.token IS NULL THEN
    RETURN NULL;
  END IF;

  -- Drop feeds whose owner left the org.
  IF NOT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = tok.org_id AND m.user_id = tok.user_id
  ) THEN
    RETURN NULL;
  END IF;

  UPDATE calendar_feed_tokens SET last_used_at = now() WHERE token = tok.token;

  SELECT jsonb_build_object(
    'orgName', o.name,
    'teamNumber', o.team_number,
    'scope', tok.scope,
    'timezone', 'UTC',
    'events', COALESCE((
      SELECT jsonb_agg(ev ORDER BY ev->>'startsAt')
      FROM (
        -- Timed subteam / whole-team calendar events. Series rows carry their
        -- RRULE so Google/Apple expand them natively; skipped occurrences ride
        -- along as EXDATEs and detached rows as RECURRENCE-ID overrides.
        SELECT jsonb_build_object(
          'id', e.id::text,
          'title', e.title,
          'kind', e.kind,
          'location', e.location,
          'description', e.notes,
          'startsAt', e.starts_at,
          'endsAt', e.ends_at,
          'updatedAt', e.updated_at,
          'allDay', false,
          'rrule', e.rrule,
          'recurrenceEnd', e.recurrence_end,
          'timeZone', e.recurrence_timezone,
          'seriesUid', CASE WHEN e.series_id IS NOT NULL AND e.series_id <> e.id
                            THEN e.series_id::text END,
          'recurrenceId', (
            SELECT to_jsonb(x.occurrence_date)
            FROM calendar_event_exceptions x
            WHERE x.detached_event_id = e.id
            LIMIT 1
          ),
          'exdates', CASE WHEN e.rrule IS NULL THEN '[]'::jsonb ELSE COALESCE((
            SELECT jsonb_agg(x.occurrence_date ORDER BY x.occurrence_date)
            FROM calendar_event_exceptions x
            WHERE x.series_id = e.id AND x.action = 'skipped'
          ), '[]'::jsonb) END
        ) AS ev
        FROM subteam_calendar_events e
        WHERE e.org_id = tok.org_id
          AND (
            (e.starts_at > now() - interval '60 days' AND e.starts_at < now() + interval '400 days')
            OR (
              e.rrule IS NOT NULL
              AND e.starts_at < now() + interval '400 days'
              AND (e.recurrence_end IS NULL OR e.recurrence_end > CURRENT_DATE - 60)
            )
          )
          AND (
            (tok.scope = 'org')
            OR (
              tok.scope = 'personal'
              AND (
                e.subteam_id IS NULL
                OR EXISTS (
                  SELECT 1 FROM team_subteam_members sm
                  WHERE sm.subteam_id = e.subteam_id
                    AND sm.user_id = tok.user_id
                )
              )
            )
            OR (
              tok.scope = 'subteam'
              AND (
                e.subteam_id IS NULL
                OR e.subteam_id = tok.subteam_id
              )
            )
          )

        UNION ALL

        -- Season milestones as all-day DATE events (date-only, no shop TZ)
        SELECT jsonb_build_object(
          'id', m.id::text,
          'title', m.title,
          'kind', m.kind,
          'location', '',
          'description', m.notes,
          'startsAt', m.starts_on::text,
          'endsAt', COALESCE(m.ends_on, m.starts_on)::text,
          'updatedAt', m.updated_at,
          'allDay', true
        ) AS ev
        FROM season_milestones m
        WHERE m.org_id = tok.org_id
          AND m.starts_on > (CURRENT_DATE - 60)
          AND m.starts_on < (CURRENT_DATE + 400)
      ) combined
    ), '[]'::jsonb)
  )
  INTO result
  FROM organizations o
  WHERE o.id = tok.org_id;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION get_calendar_feed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_calendar_feed(text) TO vantage_app, vantage_worker;
