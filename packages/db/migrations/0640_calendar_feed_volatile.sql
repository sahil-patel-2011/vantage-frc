-- Calendar subscriptions have never worked. Make the feed function VOLATILE.
--
-- get_calendar_feed is declared STABLE (0144, again in 0155, again in 0456) and
-- its body runs `UPDATE calendar_feed_tokens SET last_used_at = now()`.
-- PostgreSQL refuses data-modifying statements in a non-volatile function: SPI
-- raises `UPDATE is not allowed in a non-volatile function` (SQLSTATE 0A000)
-- before any rows come back. Reproduced here against a real database with a
-- real, valid token — the call fails for EVERY token, not an edge case.
--
-- apps/web/app/api/calendar/feed/[token]/route.ts catches the throw and returns
-- 404 "Calendar feed not found", so the product blames the user's link for a
-- function that cannot execute. Every webcal/ICS URL the team has ever handed
-- out has been dead since the feature shipped.
--
-- The fix is to drop the volatility marker, which is how the sibling public
-- token resolver already works: get_display_snapshot (0153) performs the
-- identical `UPDATE ... last_used_at` and is left VOLATILE, so it functions.
--
-- The body below is byte-for-byte the 0456 definition with only the STABLE
-- line removed. Nothing else about the feed changes.

CREATE OR REPLACE FUNCTION get_calendar_feed(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
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
