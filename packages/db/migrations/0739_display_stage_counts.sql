-- Pit TV stage: playoff order, typo matches, and played matches.
--
-- get_display_stage (0692) had three counting mistakes, mirrored in the signed-in preview
-- (apps/web/lib/display/index.ts DISPLAY_STAGE_SELECT, changed with this migration):
--
-- 1. Playoff matches were ordered by comp_level as text, so 'f' sorted before 'qf' and 'sf'
--    and the bracket listed the Finals before the semifinals. Order by round instead.
-- 2. A scout who typed a match that does not exist (qm99) creates a placeholder row in
--    matches_ref. Those rows counted toward the qualification total, so the TV never reached
--    alliance selection. Placeholders are left out of every count and list here.
-- 3. A match only counted as played once it had actual_time. Off-season events often post
--    scores without one, which kept the TV on "before the event". A posted result now counts.
--
-- The rest of the function is unchanged from 0692.

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
        'qualsPlayed', count(*) FILTER (WHERE m.comp_level = 'qm' AND (m.actual_time IS NOT NULL OR m.post_result_time IS NOT NULL OR m.winning_alliance IS NOT NULL))::int,
        'playoffTotal', count(*) FILTER (WHERE m.comp_level <> 'qm')::int,
        'playoffPlayed', count(*) FILTER (WHERE m.comp_level <> 'qm' AND (m.actual_time IS NOT NULL OR m.post_result_time IS NOT NULL OR m.winning_alliance IS NOT NULL))::int
      )
      FROM matches_ref m WHERE m.event_key = c.active_event_key AND NOT m.placeholder
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
      SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p."roundOrder", p."setNumber", p."matchNumber"), '[]'::jsonb)
      FROM (
        SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.set_number AS "setNumber",
               m.match_number AS "matchNumber", m.red_alliance AS "redAlliance",
               m.blue_alliance AS "blueAlliance", m.winning_alliance AS "winningAlliance",
               COALESCE(m.predicted_time, m.event_time) AS "scheduledTime",
               CASE m.comp_level WHEN 'ef' THEN 0 WHEN 'qf' THEN 1 WHEN 'sf' THEN 2 WHEN 'f' THEN 3 ELSE 4 END AS "roundOrder"
        FROM matches_ref m
        WHERE m.event_key = c.active_event_key AND m.comp_level <> 'qm' AND NOT m.placeholder
        ORDER BY "roundOrder", m.set_number, m.match_number
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

REVOKE ALL ON FUNCTION get_display_stage(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_display_stage(text) TO vantage_display;
GRANT EXECUTE ON FUNCTION get_display_stage(text) TO vantage_app;
