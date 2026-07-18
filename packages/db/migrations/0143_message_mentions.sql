-- Team Messages @mentions: persist mentioned members + allow peer notification inserts.

CREATE TABLE IF NOT EXISTS org_message_mentions (
  message_id uuid NOT NULL REFERENCES org_messages(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS org_message_mentions_user_idx
  ON org_message_mentions(mentioned_user_id, org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS org_message_mentions_org_idx
  ON org_message_mentions(org_id, created_at DESC);

ALTER TABLE org_message_mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_message_mentions_member_read ON org_message_mentions;
CREATE POLICY org_message_mentions_member_read ON org_message_mentions FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM org_messages m
      WHERE m.id = message_id
        AND m.org_id = org_message_mentions.org_id
        AND can_access_org_conversation(m.conversation_id)
    )
  );

DROP POLICY IF EXISTS org_message_mentions_author_insert ON org_message_mentions;
CREATE POLICY org_message_mentions_author_insert ON org_message_mentions FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM org_messages m
      WHERE m.id = message_id
        AND m.org_id = org_message_mentions.org_id
        AND m.author_user_id = current_app_user_id()
        AND can_access_org_conversation(m.conversation_id)
    )
    AND EXISTS (
      SELECT 1 FROM memberships mem
      WHERE mem.org_id = org_message_mentions.org_id
        AND mem.user_id = mentioned_user_id
    )
  );

GRANT SELECT, INSERT, DELETE ON org_message_mentions TO vantage_app, vantage_worker;

DROP POLICY IF EXISTS notifications_message_mention_insert ON notifications;
CREATE POLICY notifications_message_mention_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'message_mention'
    AND org_id IS NOT NULL
    AND is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );
