-- Two changes, one batch.
--
-- 1. Owners and admins hear when someone they invited joins.
--
-- A new owner invited a student and a mentor; when they joined, nothing said so: no inbox row,
-- nothing on Home, only "People (2)" on Team admin. The joiner's own request now tells the
-- team's owners and admins ("Sam Student joined as Student").
--
-- The insert is the joiner's, so it needs a peer-insert policy, as the dues follow-up (0603)
-- has. It is narrow on purpose, so no member can use it to message admins at will:
--   * only the 'invite_accepted' type, to an owner or admin of that same team;
--   * the payload names the inserting user, so nobody can announce someone else;
--   * only within ten minutes of the inserting user's own membership being created.

DROP POLICY IF EXISTS notifications_invite_accepted_peer_insert ON notifications;
CREATE POLICY notifications_invite_accepted_peer_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'invite_accepted'
    AND org_id IS NOT NULL
    AND payload->>'userId' = current_app_user_id()::text
    AND EXISTS (
      SELECT 1 FROM memberships joiner
      WHERE joiner.org_id = notifications.org_id
        AND joiner.user_id = current_app_user_id()
        AND joiner.created_at > now() - interval '10 minutes'
    )
    AND EXISTS (
      SELECT 1 FROM memberships lead
      WHERE lead.org_id = notifications.org_id
        AND lead.user_id = notifications.user_id
        AND lead.role IN ('owner', 'admin')
    )
  );

-- 2. The pit TV says what each robot does, partners included.
--
-- The TV showed opponents a one-word tag ("Physical") and our partners nothing, while the
-- briefing had "Likely plan: cycles fast, goes for the endgame" for every robot. The TV intel
-- function (last defined in 0692) now also returns each robot's scouted strengths from the saved
-- match plan; the app turns them into the same plain line. Otherwise unchanged from 0692.

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
               -- Each robot's scouted strengths only (no entry ids, notes or weights), so the TV
               -- can say "cycles fast, goes for the endgame" under partners and opponents alike.
               'operations', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'teamKey', op->>'teamKey',
                          'autoCapability', op->'autoCapability',
                          'teleopCapability', op->'teleopCapability',
                          'endgameCapability', op->'endgameCapability',
                          'defenseLikely', op->'defenseLikely'))
                   FROM jsonb_array_elements(COALESCE(s.plan -> 'operations', '[]'::jsonb)) op
               ), '[]'::jsonb),
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
