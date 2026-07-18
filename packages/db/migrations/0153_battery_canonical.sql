-- CD #48: one canonical battery model.
-- Keep battery_packs / battery_logs (0048). Migrate leftover rows from the
-- parallel batteries / battery_readings tables (0024), then drop the legacy
-- pair so pit, display, and /batteries all read the same fleet.

ALTER TABLE battery_packs
  ADD COLUMN IF NOT EXISTS assignment text NOT NULL DEFAULT '';

DO $$
BEGIN
  -- No-op when 0150_battery_canonical already dropped legacy tables.
  IF to_regclass('public.batteries') IS NOT NULL THEN
    -- Prefer an existing pack with the same org+label; otherwise insert using the
    -- legacy UUID so readings can keep the same battery_id.
    INSERT INTO battery_packs (
      id, org_id, label, purchase_date, status, notes, assignment, created_by, created_at, updated_at
    )
    SELECT
      b.id,
      b.org_id,
      b.asset_tag,
      b.acquired_at,
      CASE b.status WHEN 'service' THEN 'quarantine' ELSE b.status END,
      CASE
        WHEN COALESCE(b.retirement_reason, '') <> '' THEN b.retirement_reason
        WHEN b.cycle_count > 0 THEN 'Migrated from legacy fleet · prior cycle_count=' || b.cycle_count::text
        ELSE ''
      END,
      '',
      COALESCE(
        (SELECT r.recorded_by FROM battery_readings r WHERE r.battery_id = b.id ORDER BY r.created_at ASC LIMIT 1),
        (SELECT m.user_id FROM memberships m
          WHERE m.org_id = b.org_id
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at ASC
          LIMIT 1)
      ),
      b.created_at,
      b.updated_at
    FROM batteries b
    WHERE NOT EXISTS (
      SELECT 1 FROM battery_packs p WHERE p.org_id = b.org_id AND p.label = b.asset_tag
    )
    AND COALESCE(
      (SELECT r.recorded_by FROM battery_readings r WHERE r.battery_id = b.id ORDER BY r.created_at ASC LIMIT 1),
      (SELECT m.user_id FROM memberships m
        WHERE m.org_id = b.org_id
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at ASC
        LIMIT 1)
    ) IS NOT NULL;

    IF to_regclass('public.battery_readings') IS NOT NULL THEN
      INSERT INTO battery_logs (
        id, org_id, battery_id, kind, resting_voltage, internal_resistance_mohm, note, logged_by, created_at
      )
      SELECT
        r.id,
        r.org_id,
        map.pack_id,
        'resistance_test',
        r.voltage,
        r.internal_resistance_milliohms,
        concat_ws(
          ' · ',
          'Migrated reading',
          CASE WHEN r.charger_cycles IS NOT NULL THEN 'charger_cycles=' || r.charger_cycles::text END,
          CASE WHEN COALESCE(r.source, '') <> '' THEN 'source=' || r.source END
        ),
        r.recorded_by,
        COALESCE(r.measured_at, r.created_at)
      FROM battery_readings r
      JOIN LATERAL (
        SELECT COALESCE(
          (SELECT p.id FROM battery_packs p
            JOIN batteries b ON b.id = r.battery_id
            WHERE p.org_id = b.org_id AND p.label = b.asset_tag
            LIMIT 1),
          r.battery_id
        ) AS pack_id
      ) map ON true
      WHERE EXISTS (SELECT 1 FROM battery_packs p WHERE p.id = map.pack_id)
        AND NOT EXISTS (SELECT 1 FROM battery_logs l WHERE l.id = r.id);
    END IF;

    DROP TABLE IF EXISTS battery_readings;
    DROP TABLE IF EXISTS batteries;
  END IF;
END $$;

COMMENT ON TABLE battery_packs IS 'Canonical FRC battery fleet (CD #48). Prefer over legacy batteries.';
COMMENT ON TABLE battery_logs IS 'Canonical append-only battery events/measurements (CD #48). Prefer over legacy battery_readings.';

-- Display kiosk readiness counts follow the canonical fleet (quarantine ≡ service).
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
