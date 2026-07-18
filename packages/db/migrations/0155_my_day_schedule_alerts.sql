-- Competition My Day: track our-match schedule fingerprints per org/event and
-- fan out match_alert inbox rows when TBA sync changes times or alliances.
-- Also extends get_calendar_feed so personal/org subscribe URLs include our matches.

CREATE TABLE IF NOT EXISTS org_match_schedule_state (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key) ON DELETE CASCADE,
  fingerprint text NOT NULL DEFAULT '',
  our_match_count integer NOT NULL DEFAULT 0 CHECK (our_match_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, event_key)
);

CREATE INDEX IF NOT EXISTS org_match_schedule_state_event_idx
  ON org_match_schedule_state(event_key);

ALTER TABLE org_match_schedule_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_match_schedule_state_select ON org_match_schedule_state;
CREATE POLICY org_match_schedule_state_select ON org_match_schedule_state
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT ON org_match_schedule_state TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_match_schedule_state TO vantage_worker;

-- Peer-insert so coaches / SECURITY DEFINER paths can notify org members.
DROP POLICY IF EXISTS notifications_match_alert_insert ON notifications;
CREATE POLICY notifications_match_alert_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'match_alert'
    AND org_id IS NOT NULL
    AND is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );

-- Stable fingerprint matching apps/web/lib/my-day.ts scheduleFingerprint shape:
-- matchKey|scheduledTime|side|redCsv|blueCsv joined by ';'
CREATE OR REPLACE FUNCTION match_schedule_fingerprint(p_event_key text, p_team_key text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(string_agg(part, ';' ORDER BY ord), '')
  FROM (
    SELECT
      (
        m.match_key
        || '|'
        || COALESCE(COALESCE(m.actual_time, m.predicted_time, m.event_time)::text, '')
        || '|'
        || CASE
             WHEN m.red_alliance->'teamKeys' ? p_team_key THEN 'red'
             WHEN m.blue_alliance->'teamKeys' ? p_team_key THEN 'blue'
             ELSE '?'
           END
        || '|'
        || COALESCE((
             SELECT string_agg(elem, ',' ORDER BY ord)
             FROM jsonb_array_elements_text(m.red_alliance->'teamKeys')
               WITH ORDINALITY AS t(elem, ord)
           ), '')
        || '|'
        || COALESCE((
             SELECT string_agg(elem, ',' ORDER BY ord)
             FROM jsonb_array_elements_text(m.blue_alliance->'teamKeys')
               WITH ORDINALITY AS t(elem, ord)
           ), '')
      ) AS part,
      row_number() OVER (
        ORDER BY
          CASE m.comp_level
            WHEN 'qm' THEN 0 WHEN 'ef' THEN 1 WHEN 'qf' THEN 2
            WHEN 'sf' THEN 3 WHEN 'f' THEN 4 ELSE 5
          END,
          m.match_number
      ) AS ord
    FROM matches_ref m
    WHERE m.event_key = p_event_key
      AND (
        m.red_alliance->'teamKeys' ? p_team_key
        OR m.blue_alliance->'teamKeys' ? p_team_key
      )
  ) parts;
$$;

REVOKE ALL ON FUNCTION match_schedule_fingerprint(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_schedule_fingerprint(text, text) TO vantage_app, vantage_worker;

CREATE OR REPLACE FUNCTION emit_match_schedule_alerts(p_event_keys text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_emitted integer := 0;
  rec record;
  v_team_key text;
  v_fp text;
  v_count integer;
  v_prev text;
  v_reason text;
  v_inserted integer;
BEGIN
  IF p_event_keys IS NULL OR cardinality(p_event_keys) < 1 THEN
    RETURN 0;
  END IF;

  FOR rec IN
    SELECT o.id AS org_id,
           o.team_number,
           c.active_event_key AS event_key,
           e.name AS event_name
    FROM organizations o
    JOIN org_active_context c ON c.org_id = o.id
    LEFT JOIN events_ref e ON e.event_key = c.active_event_key
    WHERE c.active_event_key = ANY (p_event_keys)
      AND o.team_number IS NOT NULL
  LOOP
    v_team_key := 'frc' || rec.team_number::text;
    v_fp := match_schedule_fingerprint(rec.event_key, v_team_key);

    SELECT count(*)::int INTO v_count
    FROM matches_ref m
    WHERE m.event_key = rec.event_key
      AND (
        m.red_alliance->'teamKeys' ? v_team_key
        OR m.blue_alliance->'teamKeys' ? v_team_key
      );

    SELECT s.fingerprint INTO v_prev
    FROM org_match_schedule_state s
    WHERE s.org_id = rec.org_id AND s.event_key = rec.event_key;

    IF v_prev IS NOT NULL AND v_prev = v_fp THEN
      UPDATE org_match_schedule_state
         SET our_match_count = v_count,
             updated_at = now()
       WHERE org_id = rec.org_id AND event_key = rec.event_key;
      CONTINUE;
    END IF;

    IF v_prev IS NULL AND v_fp = '' THEN
      INSERT INTO org_match_schedule_state (org_id, event_key, fingerprint, our_match_count)
      VALUES (rec.org_id, rec.event_key, v_fp, v_count)
      ON CONFLICT (org_id, event_key) DO UPDATE
        SET fingerprint = EXCLUDED.fingerprint,
            our_match_count = EXCLUDED.our_match_count,
            updated_at = now();
      CONTINUE;
    END IF;

    v_reason := CASE WHEN v_prev IS NULL OR v_prev = '' THEN 'schedule_posted' ELSE 'schedule_changed' END;

    INSERT INTO org_match_schedule_state (org_id, event_key, fingerprint, our_match_count)
    VALUES (rec.org_id, rec.event_key, v_fp, v_count)
    ON CONFLICT (org_id, event_key) DO UPDATE
      SET fingerprint = EXCLUDED.fingerprint,
          our_match_count = EXCLUDED.our_match_count,
          updated_at = now();

    INSERT INTO notifications (user_id, org_id, type, payload)
    SELECT m.user_id,
           rec.org_id,
           'match_alert',
           jsonb_build_object(
             'eventKey', rec.event_key,
             'eventName', rec.event_name,
             'ourMatchCount', v_count,
             'reason', v_reason
           )
    FROM memberships m
    LEFT JOIN profiles p ON p.user_id = m.user_id
    WHERE m.org_id = rec.org_id
      AND COALESCE((p.notification_prefs->>'matchAlerts')::boolean, true) IS TRUE;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_emitted := v_emitted + COALESCE(v_inserted, 0);
  END LOOP;

  RETURN v_emitted;
END;
$$;

REVOKE ALL ON FUNCTION emit_match_schedule_alerts(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION emit_match_schedule_alerts(text[]) TO vantage_app, vantage_worker;

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
  team_key text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 OR length(p_token) > 100 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO tok FROM calendar_feed_tokens WHERE token = p_token;
  IF tok.token IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.org_id = tok.org_id AND m.user_id = tok.user_id
  ) THEN
    RETURN NULL;
  END IF;

  UPDATE calendar_feed_tokens SET last_used_at = now() WHERE token = tok.token;

  SELECT CASE WHEN o.team_number IS NULL THEN NULL ELSE 'frc' || o.team_number::text END
    INTO team_key
  FROM organizations o
  WHERE o.id = tok.org_id;

  SELECT jsonb_build_object(
    'orgName', o.name,
    'teamNumber', o.team_number,
    'scope', tok.scope,
    'timezone', 'UTC',
    'events', COALESCE((
      SELECT jsonb_agg(ev ORDER BY ev->>'startsAt')
      FROM (
        SELECT jsonb_build_object(
          'id', e.id::text,
          'title', e.title,
          'kind', e.kind,
          'location', e.location,
          'description', e.notes,
          'startsAt', e.starts_at,
          'endsAt', e.ends_at,
          'updatedAt', e.updated_at,
          'allDay', false
        ) AS ev
        FROM subteam_calendar_events e
        WHERE e.org_id = tok.org_id
          AND e.starts_at > now() - interval '60 days'
          AND e.starts_at < now() + interval '400 days'
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

        UNION ALL

        SELECT jsonb_build_object(
          'id', 'match-' || mr.match_key,
          'title',
            CASE mr.comp_level
              WHEN 'qm' THEN 'Qual '
              WHEN 'qf' THEN 'QF '
              WHEN 'sf' THEN 'SF '
              WHEN 'f' THEN 'Final '
              ELSE upper(mr.comp_level) || ' '
            END
            || mr.match_number::text
            || ' · '
            || CASE
                 WHEN mr.red_alliance->'teamKeys' ? team_key THEN 'RED'
                 ELSE 'BLUE'
               END
            || ' bumpers',
          'kind', 'event',
          'location', COALESCE(ev.name, ''),
          'description',
            CASE
              WHEN mr.red_alliance->'teamKeys' ? team_key THEN 'Switch to RED bumpers'
              ELSE 'Switch to BLUE bumpers'
            END
            || E'\nOpen My Day in Vantage for scout / Event Day links.',
          'startsAt', t.slot_start,
          'endsAt', t.slot_start + interval '15 minutes',
          'updatedAt', COALESCE(mr.synced_at, t.slot_start),
          'allDay', false
        ) AS ev
        FROM org_active_context ctx
        JOIN matches_ref mr ON mr.event_key = ctx.active_event_key
        LEFT JOIN events_ref ev ON ev.event_key = ctx.active_event_key
        CROSS JOIN LATERAL (
          SELECT COALESCE(mr.actual_time, mr.predicted_time, mr.event_time) AS slot_start
        ) t
        WHERE ctx.org_id = tok.org_id
          AND tok.scope IN ('personal', 'org')
          AND team_key IS NOT NULL
          AND t.slot_start IS NOT NULL
          AND t.slot_start > now() - interval '60 days'
          AND t.slot_start < now() + interval '400 days'
          AND (
            mr.red_alliance->'teamKeys' ? team_key
            OR mr.blue_alliance->'teamKeys' ? team_key
          )
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
