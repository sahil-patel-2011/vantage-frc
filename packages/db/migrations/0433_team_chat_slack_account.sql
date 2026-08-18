-- Team chat remains org-scoped (org_messages). Optional Slack bridge mirrors the
-- Team channel both ways. Account recovery email + phone OTP live on profiles.
-- Tenancy stays Better Auth + withRls; Slack Events use ingest_slack_team_message.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS recovery_email text,
  ADD COLUMN IF NOT EXISTS phone_e164 text,
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_recovery_email_chk;
ALTER TABLE profiles ADD CONSTRAINT profiles_recovery_email_chk
  CHECK (
    recovery_email IS NULL
    OR recovery_email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
  );

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_phone_e164_chk;
ALTER TABLE profiles ADD CONSTRAINT profiles_phone_e164_chk
  CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$');

CREATE TABLE IF NOT EXISTS user_phone_otp (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 20),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_phone_otp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_phone_otp_self ON user_phone_otp;
CREATE POLICY user_phone_otp_self ON user_phone_otp FOR ALL TO vantage_app
  USING (user_id = current_app_user_id())
  WITH CHECK (user_id = current_app_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON user_phone_otp TO vantage_app, vantage_worker;

CREATE TABLE IF NOT EXISTS team_slack (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  webhook_url text,
  signing_secret text,
  workspace_id text,
  workspace_name text,
  channel_id text,
  channel_label text,
  enabled boolean NOT NULL DEFAULT true,
  chat_bridge_enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_slack_workspace_id_chk CHECK (
    workspace_id IS NULL OR workspace_id ~ '^T[A-Z0-9]{8,}$'
  ),
  CONSTRAINT team_slack_channel_id_chk CHECK (
    channel_id IS NULL OR channel_id ~ '^[CDG][A-Z0-9]{8,}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS team_slack_workspace_uq
  ON team_slack (workspace_id)
  WHERE workspace_id IS NOT NULL;

ALTER TABLE team_slack ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_slack_admin_all ON team_slack;
CREATE POLICY team_slack_admin_all ON team_slack FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND updated_by = current_app_user_id()
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON team_slack TO vantage_app, vantage_worker;

CREATE TABLE IF NOT EXISTS slack_bridge_posts (
  message_id uuid PRIMARY KEY REFERENCES org_messages(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slack_ts text,
  direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  status text NOT NULL CHECK (status IN ('posted', 'failed', 'inbound')),
  error text,
  posted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS slack_bridge_posts_org_idx
  ON slack_bridge_posts (org_id, posted_at DESC);

ALTER TABLE slack_bridge_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS slack_bridge_posts_admin_all ON slack_bridge_posts;
CREATE POLICY slack_bridge_posts_admin_all ON slack_bridge_posts FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
DROP POLICY IF EXISTS slack_bridge_posts_author_insert ON slack_bridge_posts;
CREATE POLICY slack_bridge_posts_author_insert ON slack_bridge_posts FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM org_messages m
      WHERE m.id = slack_bridge_posts.message_id
        AND m.org_id = slack_bridge_posts.org_id
        AND m.author_user_id = current_app_user_id()
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON slack_bridge_posts TO vantage_app, vantage_worker;

CREATE TABLE IF NOT EXISTS slack_inbound_events (
  slack_team_id text NOT NULL,
  event_id text NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slack_ts text,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slack_team_id, event_id)
);

CREATE INDEX IF NOT EXISTS slack_inbound_events_org_idx
  ON slack_inbound_events (org_id, ingested_at DESC);

ALTER TABLE slack_inbound_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS slack_inbound_events_admin_read ON slack_inbound_events;
CREATE POLICY slack_inbound_events_admin_read ON slack_inbound_events FOR SELECT TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
GRANT SELECT, INSERT, UPDATE, DELETE ON slack_inbound_events TO vantage_app, vantage_worker;

DROP POLICY IF EXISTS notifications_team_chat_insert ON notifications;
CREATE POLICY notifications_team_chat_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'team_chat'
    AND org_id IS NOT NULL
    AND is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );

CREATE OR REPLACE FUNCTION slack_signing_secret_for_workspace(p_workspace_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  secret text;
BEGIN
  IF p_workspace_id IS NULL OR p_workspace_id !~ '^T[A-Z0-9]{8,}$' THEN
    RETURN NULL;
  END IF;
  SELECT signing_secret INTO secret
  FROM team_slack
  WHERE workspace_id = p_workspace_id
    AND enabled
  LIMIT 1;
  RETURN secret;
END;
$$;

REVOKE ALL ON FUNCTION slack_signing_secret_for_workspace(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION slack_signing_secret_for_workspace(text) TO vantage_app, vantage_worker;

CREATE OR REPLACE FUNCTION ingest_slack_team_message(
  p_slack_team_id text,
  p_slack_channel_id text,
  p_slack_user_id text,
  p_event_id text,
  p_slack_ts text,
  p_text text,
  p_display_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  cfg RECORD;
  conv_id uuid;
  author_id uuid;
  msg_id uuid;
  body text;
  inserted int;
  display text;
BEGIN
  IF p_slack_team_id IS NULL OR p_slack_team_id !~ '^T[A-Z0-9]{8,}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_team');
  END IF;
  IF p_event_id IS NULL OR length(trim(p_event_id)) < 4 OR length(p_event_id) > 128 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_event');
  END IF;
  body := trim(COALESCE(p_text, ''));
  IF body = '' OR length(body) > 8000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_body');
  END IF;

  SELECT * INTO cfg
  FROM team_slack
  WHERE workspace_id = p_slack_team_id
    AND enabled
    AND chat_bridge_enabled
    AND (channel_id IS NULL OR channel_id = p_slack_channel_id)
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_org');
  END IF;

  INSERT INTO slack_inbound_events (slack_team_id, event_id, org_id, slack_ts)
  VALUES (p_slack_team_id, p_event_id, cfg.org_id, p_slack_ts)
  ON CONFLICT (slack_team_id, event_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 0 THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'orgId', cfg.org_id);
  END IF;

  SELECT c.id INTO conv_id
  FROM org_conversations c
  WHERE c.org_id = cfg.org_id AND c.kind = 'team' AND lower(c.title) = 'team'
  ORDER BY c.created_at
  LIMIT 1;
  IF conv_id IS NULL THEN
    INSERT INTO org_conversations (org_id, kind, title, created_by)
    VALUES (cfg.org_id, 'team', 'Team', COALESCE(cfg.updated_by, (
      SELECT m.user_id FROM memberships m
      WHERE m.org_id = cfg.org_id AND m.role IN ('owner','admin')
      ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.created_at
      LIMIT 1
    )))
    RETURNING id INTO conv_id;
  END IF;

  author_id := cfg.updated_by;
  IF author_id IS NULL THEN
    SELECT m.user_id INTO author_id
    FROM memberships m
    WHERE m.org_id = cfg.org_id AND m.role IN ('owner','admin')
    ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.created_at
    LIMIT 1;
  END IF;
  IF author_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_author');
  END IF;

  display := left(trim(COALESCE(p_display_name, p_slack_user_id, 'Slack')), 80);
  IF display = '' THEN display := 'Slack'; END IF;
  body := left('[Slack · ' || display || '] ' || body, 8000);

  INSERT INTO org_messages (conversation_id, org_id, author_user_id, body)
  VALUES (conv_id, cfg.org_id, author_id, body)
  RETURNING id INTO msg_id;

  UPDATE org_conversations SET updated_at = now() WHERE id = conv_id;

  INSERT INTO slack_bridge_posts (message_id, org_id, slack_ts, direction, status)
  VALUES (msg_id, cfg.org_id, p_slack_ts, 'inbound', 'inbound')
  ON CONFLICT (message_id) DO NOTHING;

  INSERT INTO notifications (user_id, org_id, type, payload)
  SELECT mem.user_id, cfg.org_id, 'team_chat',
         jsonb_build_object(
           'conversationId', conv_id,
           'messageId', msg_id,
           'fromName', display,
           'preview', left(body, 120),
           'source', 'slack',
           'href', '/team?tab=messages'
         )
  FROM memberships mem
  LEFT JOIN profiles p ON p.user_id = mem.user_id
  WHERE mem.org_id = cfg.org_id
    AND mem.user_id <> author_id
    AND COALESCE((p.notification_prefs->>'teamChat')::boolean, true) IS TRUE;

  RETURN jsonb_build_object('ok', true, 'orgId', cfg.org_id, 'messageId', msg_id, 'conversationId', conv_id);
END;
$$;

REVOKE ALL ON FUNCTION ingest_slack_team_message(text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ingest_slack_team_message(text, text, text, text, text, text, text) TO vantage_app, vantage_worker;

COMMENT ON TABLE team_slack IS
  'Org Slack bridge. Webhook/signing secret are admin-only. Chat stays org_id isolated.';
COMMENT ON FUNCTION ingest_slack_team_message(text, text, text, text, text, text, text) IS
  'Slack Events ingest into the Team channel. Never crosses orgs.';
