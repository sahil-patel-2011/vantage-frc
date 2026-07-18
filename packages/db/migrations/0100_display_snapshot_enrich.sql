-- Enrich pit-TV display snapshots: team-scoped next match, stored Strategy
-- predictions, TBA/Statbotics rank-record, pit readiness counts, and strategy
-- headline. Still returns null/zero for missing modules -- never DEMO filler.

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
        AND COALESCE(m.actual_time, m.predicted_time, m.event_time) > now()
      ORDER BY COALESCE(m.actual_time, m.predicted_time, m.event_time)
      LIMIT 1
    ),
    'prediction', (
      SELECT jsonb_build_object(
        'matchKey', p.match_key, 'pRed', p.p_red, 'pBlue', p.p_blue,
        'confidenceLow', p.confidence_low, 'confidenceHigh', p.confidence_high,
        'modelVersion', p.model_version, 'keyFactors', p.key_factors, 'caveats', p.caveats, 'scoredAt', p.scored_at
      )
      FROM predictions p
      JOIN matches_ref m ON m.match_key = p.match_key
      WHERE p.org_id = o.id AND m.event_key = c.active_event_key
      ORDER BY
        CASE WHEN p.match_key = (
          SELECT m2.match_key FROM matches_ref m2
          WHERE m2.event_key = c.active_event_key
            AND (
              m2.red_alliance->'teamKeys' ? ('frc' || o.team_number::text)
              OR m2.blue_alliance->'teamKeys' ? ('frc' || o.team_number::text)
            )
            AND COALESCE(m2.actual_time, m2.predicted_time, m2.event_time) > now()
          ORDER BY COALESCE(m2.actual_time, m2.predicted_time, m2.event_time)
          LIMIT 1
        ) THEN 0 ELSE 1 END,
        p.scored_at DESC
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
      'batteriesActive', (SELECT count(*)::int FROM batteries bat WHERE bat.org_id = o.id AND bat.status = 'active'),
      'batteriesService', (SELECT count(*)::int FROM batteries bat WHERE bat.org_id = o.id AND bat.status = 'service'),
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

REVOKE ALL ON FUNCTION get_display_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_display_snapshot(text) TO vantage_display;
