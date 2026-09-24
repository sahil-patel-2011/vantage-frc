-- Pit TV: what the team already knows about its next match.
--
-- The phase-aware pit board (/display/stage) showed the next match's teams and time but none
-- of what the team had worked out about it: the stored win prediction and the opponent
-- tendencies the strategy engine saved with the match plan (match_strategies.plan.tendencies,
-- built from scouting and public metrics). The TV runs on a read-only display token, so this
-- is a SECURITY DEFINER function in the same shape as get_display_stage (0464): it checks the
-- token, and only ever returns the token's own team's rows for one match at that team's
-- active event.
--
-- Returns NULL when the match is not at the active event. Nothing is invented: a match with
-- no stored prediction or plan comes back with nulls and an empty list.

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
