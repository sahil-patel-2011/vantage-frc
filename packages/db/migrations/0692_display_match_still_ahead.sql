-- Pit TV: a match running late is still our next match.
--
-- The TV functions picked "our next match" as the first one whose time was still in the future.
-- When the event ran 30 minutes behind, Qual 31 (3:07 PM, unplayed) dropped off the TV at 3:08
-- and the board jumped to Qual 33 while the field was still on 31. The app's own queries use the
-- same rule as match_still_ahead() below (apps/web/lib/matches/match-ahead-sql.ts); the token
-- (TV) path now does too.
--
-- A match is over once it has a result or a start time, once a later qualification match at the
-- event has one, or once its scheduled time is more than three hours gone. Anything else is
-- still ahead, late or not.
--
-- Both payloads also carry 'field': the first qualification match still to be played and its
-- printed time. The TV counts down to our match from where the field actually is (printed time
-- plus how late the field is running), not from the printed schedule alone. Otherwise the two
-- functions are unchanged from 0689 and 0464.
--
-- get_display_match_intel (0685) also returns the saved game plan's priorities, so the TV can
-- say "Game plan: Defend 118 · Play a clean match" instead of one-word tags alone. The app
-- shortens them to the instruction before they reach the TV (lib/display/match-intel.ts).

CREATE OR REPLACE FUNCTION match_still_ahead(m matches_ref) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT NOT (
    m.winning_alliance IS NOT NULL
    OR m.post_result_time IS NOT NULL
    OR m.actual_time IS NOT NULL
    OR COALESCE(m.predicted_time, m.event_time) <= now() - interval '3 hours'
    OR (
      m.comp_level = 'qm'
      AND EXISTS (
        SELECT 1 FROM matches_ref later_m
         WHERE later_m.event_key = m.event_key
           AND later_m.comp_level = 'qm'
           AND later_m.match_number > m.match_number
           AND (later_m.winning_alliance IS NOT NULL OR later_m.post_result_time IS NOT NULL OR later_m.actual_time IS NOT NULL)
      )
    )
  )
$$;

REVOKE ALL ON FUNCTION match_still_ahead(matches_ref) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_still_ahead(matches_ref) TO vantage_app, vantage_worker, vantage_display;

CREATE OR REPLACE FUNCTION get_display_snapshot(raw_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  token_row display_tokens%ROWTYPE;
  result jsonb;
BEGIN
  SELECT * INTO token_row
  FROM display_tokens
  WHERE token_hash = encode(digest(raw_token, 'sha256'), 'hex')
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  FOR UPDATE;
  IF token_row.id IS NULL THEN
    RAISE EXCEPTION 'Display token is invalid or expired';
  END IF;

  UPDATE display_tokens SET last_used_at = now() WHERE id = token_row.id;

  SELECT jsonb_build_object(
    'board', jsonb_build_object('id', b.id, 'name', b.name, 'preset', b.preset, 'widgets', b.widgets),
    'organization', jsonb_build_object('name', o.name, 'teamNumber', o.team_number),
    'activeEvent', jsonb_build_object('eventKey', c.active_event_key, 'name', e.name),
    'nextMatch', (
      SELECT jsonb_build_object(
        'matchKey', m.match_key, 'compLevel', m.comp_level, 'matchNumber', m.match_number,
        'scheduledTime', COALESCE(m.predicted_time, m.event_time),
        'redAlliance', m.red_alliance, 'blueAlliance', m.blue_alliance
      )
      FROM matches_ref m
      WHERE m.event_key = c.active_event_key
        AND (
          m.red_alliance->'teamKeys' ? ('frc' || o.team_number::text)
          OR m.blue_alliance->'teamKeys' ? ('frc' || o.team_number::text)
        )
        AND match_still_ahead(m)
      ORDER BY COALESCE(m.actual_time, m.predicted_time, m.event_time)
      LIMIT 1
    ),
    -- Only the prediction for our next match. It used to fall back to the newest prediction
    -- for any match at the event, so after the last match the TV kept showing old odds.
    'prediction', (
      SELECT jsonb_build_object(
        'matchKey', p.match_key, 'pRed', p.p_red, 'pBlue', p.p_blue,
        'confidenceLow', p.confidence_low, 'confidenceHigh', p.confidence_high,
        'modelVersion', p.model_version, 'keyFactors', p.key_factors, 'caveats', p.caveats, 'scoredAt', p.scored_at
      )
      FROM predictions p
      WHERE p.org_id = o.id
        AND p.match_key = (
          SELECT m2.match_key FROM matches_ref m2
          WHERE m2.event_key = c.active_event_key
            AND (
              m2.red_alliance->'teamKeys' ? ('frc' || o.team_number::text)
              OR m2.blue_alliance->'teamKeys' ? ('frc' || o.team_number::text)
            )
            AND match_still_ahead(m2)
          ORDER BY COALESCE(m2.actual_time, m2.predicted_time, m2.event_time)
          LIMIT 1
        )
      ORDER BY p.scored_at DESC
      LIMIT 1
    ),
    'eventStatus', (
      SELECT jsonb_build_object('rank', tem.rank, 'wins', tem.wins, 'losses', tem.losses, 'ties', tem.ties, 'source', tem.source)
      FROM team_event_metrics tem
      WHERE tem.event_key = c.active_event_key AND tem.team_key = ('frc' || o.team_number::text)
      ORDER BY CASE tem.source WHEN 'tba' THEN 0 WHEN 'statbotics' THEN 1 ELSE 2 END, tem.synced_at DESC
      LIMIT 1
    ),
    'readiness', jsonb_build_object(
      'batteriesActive', (SELECT count(*)::int FROM battery_packs bat WHERE bat.org_id = o.id AND bat.status = 'active'),
      'batteriesService', (SELECT count(*)::int FROM battery_packs bat WHERE bat.org_id = o.id AND bat.status = 'quarantine'),
      'openFailures', (
        SELECT count(*)::int FROM robot_failures rf
        WHERE rf.org_id = o.id AND rf.resolution IS NULL
          AND (c.active_event_key IS NULL OR rf.event_key IS NULL OR rf.event_key = c.active_event_key)
      ),
      'openMaintenance', (SELECT count(*)::int FROM maintenance_items mi WHERE mi.org_id = o.id AND mi.completed_at IS NULL)
    ),
    'scouting', jsonb_build_object(
      'assignments', (SELECT count(*)::int FROM scout_assignments a WHERE a.org_id = o.id AND a.event_key = c.active_event_key),
      'reports', (SELECT count(*)::int FROM match_scout_entries s WHERE s.org_id = o.id AND s.event_key = c.active_event_key),
      'openDisagreements', (
        SELECT count(*)::int FROM scout_disagreements d
        WHERE d.org_id = o.id AND d.event_key = c.active_event_key AND d.status = 'open'
      )
    ),
    'strategyHeadline', (
      SELECT COALESCE(sp.content->>'title', sp.name)
      FROM strategy_playbooks sp WHERE sp.org_id = o.id
      ORDER BY sp.updated_at DESC NULLS LAST, sp.created_at DESC LIMIT 1
    ),
    'field', (
      SELECT jsonb_build_object('matchNumber', fm.match_number, 'scheduledTime', COALESCE(fm.predicted_time, fm.event_time))
      FROM matches_ref fm
      WHERE fm.event_key = c.active_event_key AND fm.comp_level = 'qm' AND match_still_ahead(fm)
      ORDER BY fm.match_number
      LIMIT 1
    ),
    'updatedAt', now()
  ) INTO result
  FROM display_boards b
  JOIN organizations o ON o.id = b.org_id
  LEFT JOIN org_active_context c ON c.org_id = o.id
  LEFT JOIN events_ref e ON e.event_key = c.active_event_key
  WHERE b.id = token_row.board_id AND b.org_id = token_row.org_id;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Display board not found';
  END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION get_display_stage(raw_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  token_row display_tokens%ROWTYPE;
  board_row display_boards%ROWTYPE;
  result jsonb;
BEGIN
  SELECT * INTO token_row
  FROM display_tokens
  WHERE token_hash = encode(digest(raw_token, 'sha256'), 'hex')
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now());
  IF token_row.id IS NULL THEN
    RAISE EXCEPTION 'Display token is invalid or expired';
  END IF;

  SELECT * INTO board_row FROM display_boards
  WHERE id = token_row.board_id AND org_id = token_row.org_id;
  IF board_row.id IS NULL THEN
    RAISE EXCEPTION 'Display board not found';
  END IF;

  UPDATE display_tokens SET last_used_at = now() WHERE id = token_row.id;

  SELECT jsonb_build_object(
    'board', jsonb_build_object('id', board_row.id, 'name', board_row.name, 'preset', board_row.preset),
    'organization', jsonb_build_object('name', o.name, 'teamNumber', o.team_number),
    'activeEvent', jsonb_build_object(
      'eventKey', c.active_event_key, 'name', e.name,
      'startDate', e.start_date, 'endDate', e.end_date
    ),
    'progress', (
      SELECT jsonb_build_object(
        'qualsTotal', count(*) FILTER (WHERE m.comp_level = 'qm')::int,
        'qualsPlayed', count(*) FILTER (WHERE m.comp_level = 'qm' AND m.actual_time IS NOT NULL)::int,
        'playoffTotal', count(*) FILTER (WHERE m.comp_level <> 'qm')::int,
        'playoffPlayed', count(*) FILTER (WHERE m.comp_level <> 'qm' AND m.actual_time IS NOT NULL)::int
      )
      FROM matches_ref m WHERE m.event_key = c.active_event_key
    ),
    'schedule', (
      SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s."scheduledTime"), '[]'::jsonb)
      FROM (
        SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
               COALESCE(m.predicted_time, m.event_time) AS "scheduledTime",
               m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance"
        FROM matches_ref m
        WHERE m.event_key = c.active_event_key
          AND (
            m.red_alliance->'teamKeys' ? ('frc' || o.team_number::text)
            OR m.blue_alliance->'teamKeys' ? ('frc' || o.team_number::text)
          )
          AND match_still_ahead(m)
        ORDER BY COALESCE(m.actual_time, m.predicted_time, m.event_time)
        LIMIT 6
      ) s
    ),
    'rankings', (
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.rank), '[]'::jsonb)
      FROM (
        SELECT * FROM (
          SELECT DISTINCT ON (tem.team_key)
            tem.team_key AS "teamKey", tem.rank, tem.wins, tem.losses, tem.ties, tem.source
          FROM team_event_metrics tem
          WHERE tem.event_key = c.active_event_key AND tem.rank IS NOT NULL
          ORDER BY tem.team_key,
            CASE tem.source WHEN 'tba' THEN 0 WHEN 'statbotics' THEN 1 ELSE 2 END,
            tem.synced_at DESC
        ) ranked
        ORDER BY ranked.rank
        LIMIT 12
      ) r
    ),
    'eventStatus', (
      SELECT jsonb_build_object('rank', tem.rank, 'wins', tem.wins, 'losses', tem.losses,
                                'ties', tem.ties, 'source', tem.source)
      FROM team_event_metrics tem
      WHERE tem.event_key = c.active_event_key AND tem.team_key = ('frc' || o.team_number::text)
      ORDER BY CASE tem.source WHEN 'tba' THEN 0 WHEN 'statbotics' THEN 1 ELSE 2 END, tem.synced_at DESC
      LIMIT 1
    ),
    'playoffMatches', (
      SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p."compLevel", p."setNumber", p."matchNumber"), '[]'::jsonb)
      FROM (
        SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.set_number AS "setNumber",
               m.match_number AS "matchNumber", m.red_alliance AS "redAlliance",
               m.blue_alliance AS "blueAlliance", m.winning_alliance AS "winningAlliance",
               COALESCE(m.predicted_time, m.event_time) AS "scheduledTime"
        FROM matches_ref m
        WHERE m.event_key = c.active_event_key AND m.comp_level <> 'qm'
        ORDER BY m.comp_level, m.set_number, m.match_number
        LIMIT 32
      ) p
    ),
    'sponsors', (
      SELECT COALESCE(jsonb_agg(to_jsonb(sp) ORDER BY sp.name), '[]'::jsonb)
      FROM (
        SELECT s.name, s.tier::text AS tier
        FROM sponsors s
        WHERE s.org_id = board_row.org_id AND s.status = 'active'
        ORDER BY s.name
        LIMIT 60
      ) sp
    ),
    'nexus', (
      SELECT jsonb_build_object(
        'live', ns.live, 'pits', ns.pits, 'map', ns.map, 'syncedAt', ns.synced_at
      )
      FROM nexus_event_snapshots ns WHERE ns.event_key = c.active_event_key
    ),
    'field', (
      SELECT jsonb_build_object('matchNumber', fm.match_number, 'scheduledTime', COALESCE(fm.predicted_time, fm.event_time))
      FROM matches_ref fm
      WHERE fm.event_key = c.active_event_key AND fm.comp_level = 'qm' AND match_still_ahead(fm)
      ORDER BY fm.match_number
      LIMIT 1
    ),
    'updatedAt', now()
  ) INTO result
  FROM organizations o
  LEFT JOIN org_active_context c ON c.org_id = o.id
  LEFT JOIN events_ref e ON e.event_key = c.active_event_key
  WHERE o.id = board_row.org_id;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Display board not found';
  END IF;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION get_display_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_display_snapshot(text) TO vantage_display;
GRANT EXECUTE ON FUNCTION get_display_snapshot(text) TO vantage_app;

REVOKE ALL ON FUNCTION get_display_stage(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_display_stage(text) TO vantage_display;
GRANT EXECUTE ON FUNCTION get_display_stage(text) TO vantage_app;

CREATE OR REPLACE FUNCTION get_display_match_intel(raw_token text, requested_match_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  token_row display_tokens%ROWTYPE;
  active_key text;
  result jsonb;
BEGIN
  SELECT * INTO token_row
  FROM display_tokens
  WHERE token_hash = encode(digest(raw_token, 'sha256'), 'hex')
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now());
  IF token_row.id IS NULL THEN
    RAISE EXCEPTION 'Display token is invalid or expired';
  END IF;

  SELECT c.active_event_key INTO active_key FROM org_active_context c WHERE c.org_id = token_row.org_id;
  IF active_key IS NULL OR NOT EXISTS (
    SELECT 1 FROM matches_ref m WHERE m.match_key = requested_match_key AND m.event_key = active_key
  ) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'matchKey', requested_match_key,
    'prediction', (
      SELECT jsonb_build_object('pRed', p.p_red, 'pBlue', p.p_blue, 'scoredAt', p.scored_at)
        FROM predictions p
       WHERE p.org_id = token_row.org_id AND p.match_key = requested_match_key
       ORDER BY p.scored_at DESC
       LIMIT 1
    ),
    'plan', (
      SELECT jsonb_build_object(
               'alliance', s.alliance,
               'tendencies', COALESCE(s.plan -> 'tendencies', '[]'::jsonb),
               'priorities', COALESCE(s.plan -> 'playbook' -> 'priorities', '[]'::jsonb),
               'updatedAt', s.updated_at
             )
        FROM match_strategies s
       WHERE s.org_id = token_row.org_id AND s.match_key = requested_match_key
       ORDER BY s.updated_at DESC
       LIMIT 1
    )
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION get_display_match_intel(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_display_match_intel(text, text) TO vantage_display;
GRANT EXECUTE ON FUNCTION get_display_match_intel(text, text) TO vantage_app;
