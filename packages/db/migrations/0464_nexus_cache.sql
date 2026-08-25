-- NEXUS CACHE + PHASE-AWARE PIT DISPLAY
--
-- Two changes, both about competition day reading MORE of what we already fetch.
--
-- 1. nexus_event_snapshots (0429) already caches the full `GET frc.nexus/api/v1/event/{key}`
--    body in `live` (which carries matches[], announcements[], partsRequests[] and the server
--    clock `now`) plus `GET .../pits` in `pits`. The one Nexus endpoint we never cached is
--    `GET .../map` — the venue geometry. It belongs in the SAME per-event row so the pit map
--    reads the shared cache instead of opening a per-request poll against a rate-limited API.
--    Nothing writes it yet except the Nexus ingest worker; a NULL map means "no geometry
--    cached", and the planner falls back to its own layout rather than drawing a stub venue.
--
-- 2. The pit TV runs on a read-only display token, so `vantage_display` can only EXECUTE
--    SECURITY DEFINER functions — it has no table grants at all (0009). get_display_snapshot
--    answers the single-board kiosk. The phase-aware display (pre-event -> quals -> alliance
--    selection -> playoffs -> post-event) needs event-shaped data the kiosk snapshot does not
--    carry: qual/playoff progress counts, the team's upcoming schedule, the ranking table, the
--    playoff bracket, the org's REAL sponsor rows, and the cached Nexus payload. That is a
--    second read-only function rather than a change to get_display_snapshot, so the existing
--    kiosk keeps working byte-for-byte.
--
-- Everything here is READ-ONLY for the display role, org-scoped through the token's board row,
-- and returns empty arrays where a team has no rows — never a placeholder rank or sponsor.

ALTER TABLE nexus_event_snapshots ADD COLUMN IF NOT EXISTS map jsonb;

COMMENT ON COLUMN nexus_event_snapshots.map IS
  'Cached GET frc.nexus/api/v1/event/{key}/map geometry. NULL = never fetched / no geometry.';

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
          AND COALESCE(m.actual_time, m.predicted_time, m.event_time) > now()
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
