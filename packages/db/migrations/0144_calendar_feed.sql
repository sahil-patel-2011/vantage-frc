-- Personal / org / subteam calendar subscription feeds (.ics / webcal).
-- Each org member can mint an opaque subscribe token. The public feed route
-- authenticates solely by that token (no session cookie). Rotating or deleting
-- the token immediately stops the old URL. Never expose calendar rows without
-- a valid token — there is no anonymous org calendar dump.

CREATE TABLE calendar_feed_tokens (
  token text PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- personal = whole-team + member's subteams (+ season milestones)
  -- org = every subteam event for the org (+ season milestones)
  -- subteam = one subteam + whole-team rows (+ season milestones)
  scope text NOT NULL DEFAULT 'personal'
    CHECK (scope IN ('personal', 'org', 'subteam')),
  subteam_id uuid REFERENCES team_subteams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  CONSTRAINT calendar_feed_tokens_subteam_scope CHECK (
    (scope = 'subteam' AND subteam_id IS NOT NULL)
    OR (scope <> 'subteam' AND subteam_id IS NULL)
  )
);

-- One active feed per member/scope/subteam combination.
CREATE UNIQUE INDEX calendar_feed_tokens_member_scope_uidx
  ON calendar_feed_tokens (
    org_id,
    user_id,
    scope,
    COALESCE(subteam_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX calendar_feed_tokens_org_user_idx
  ON calendar_feed_tokens(org_id, user_id);

ALTER TABLE calendar_feed_tokens ENABLE ROW LEVEL SECURITY;

-- Members manage only their own feed tokens (must still be an org member).
CREATE POLICY calendar_feed_tokens_self ON calendar_feed_tokens
  FOR ALL TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_feed_tokens TO vantage_app, vantage_worker;

-- Public feed resolver. SECURITY DEFINER so the unauthenticated .ics route can
-- read past RLS, but it only returns rows allowed by the token's scope for an
-- org the token's user still belongs to. Unknown / revoked tokens → NULL.
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
        -- Timed subteam / whole-team calendar events
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
