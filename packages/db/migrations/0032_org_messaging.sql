-- Org-scoped human team chat + private DMs (separate from agent_threads / Vantage AI).
CREATE TABLE org_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('team', 'dm')),
  title text,
  -- For DMs: lexicographically sorted "userA:userB" so each pair has one thread per org.
  dm_key text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_conversations_kind_shape_chk CHECK (
    (kind = 'team' AND title IS NOT NULL AND length(trim(title)) > 0 AND dm_key IS NULL)
    OR (kind = 'dm' AND title IS NULL AND dm_key IS NOT NULL)
  )
);

CREATE UNIQUE INDEX org_conversations_team_title_uq
  ON org_conversations(org_id, lower(title))
  WHERE kind = 'team';

CREATE UNIQUE INDEX org_conversations_dm_key_uq
  ON org_conversations(org_id, dm_key)
  WHERE kind = 'dm';

CREATE INDEX org_conversations_org_kind_idx ON org_conversations(org_id, kind, updated_at DESC);

CREATE TABLE org_conversation_participants (
  conversation_id uuid NOT NULL REFERENCES org_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX org_conversation_participants_user_idx
  ON org_conversation_participants(user_id, conversation_id);

CREATE TABLE org_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES org_conversations(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (length(trim(body)) > 0 AND length(body) <= 8000),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX org_messages_conversation_created_idx
  ON org_messages(conversation_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX org_messages_org_created_idx ON org_messages(org_id, created_at DESC);

ALTER TABLE org_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION can_access_org_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM org_conversations c
    WHERE c.id = p_conversation_id
      AND is_org_member(c.org_id)
      AND (
        c.kind = 'team'
        OR EXISTS (
          SELECT 1
          FROM org_conversation_participants p
          WHERE p.conversation_id = c.id
            AND p.user_id = current_app_user_id()
        )
        OR is_platform_admin()
      )
  );
$$;

CREATE POLICY org_conversations_member_read ON org_conversations FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      kind = 'team'
      OR EXISTS (
        SELECT 1 FROM org_conversation_participants p
        WHERE p.conversation_id = id AND p.user_id = current_app_user_id()
      )
      OR is_platform_admin()
    )
  );

CREATE POLICY org_conversations_member_insert ON org_conversations FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND created_by = current_app_user_id()
  );

CREATE POLICY org_conversations_member_update ON org_conversations FOR UPDATE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      kind = 'team'
      OR EXISTS (
        SELECT 1 FROM org_conversation_participants p
        WHERE p.conversation_id = id AND p.user_id = current_app_user_id()
      )
    )
  )
  WITH CHECK (is_org_member(org_id));

CREATE POLICY org_conversation_participants_read ON org_conversation_participants FOR SELECT TO vantage_app
  USING (can_access_org_conversation(conversation_id));

-- Allow creators to seed DM participants before they themselves are listed.
CREATE POLICY org_conversation_participants_insert ON org_conversation_participants FOR INSERT TO vantage_app
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM org_conversations c
      WHERE c.id = conversation_id
        AND is_org_member(c.org_id)
        AND (
          c.created_by = current_app_user_id()
          OR can_access_org_conversation(conversation_id)
        )
    )
  );

CREATE POLICY org_conversation_participants_update ON org_conversation_participants FOR UPDATE TO vantage_app
  USING (user_id = current_app_user_id() AND can_access_org_conversation(conversation_id))
  WITH CHECK (user_id = current_app_user_id());

CREATE POLICY org_messages_member_read ON org_messages FOR SELECT TO vantage_app
  USING (can_access_org_conversation(conversation_id));

CREATE POLICY org_messages_member_insert ON org_messages FOR INSERT TO vantage_app
  WITH CHECK (
    author_user_id = current_app_user_id()
    AND can_access_org_conversation(conversation_id)
    AND EXISTS (
      SELECT 1 FROM org_conversations c
      WHERE c.id = conversation_id AND c.org_id = org_messages.org_id
    )
  );

CREATE POLICY org_messages_author_soft_delete ON org_messages FOR UPDATE TO vantage_app
  USING (
    author_user_id = current_app_user_id()
    AND can_access_org_conversation(conversation_id)
  )
  WITH CHECK (
    author_user_id = current_app_user_id()
    AND can_access_org_conversation(conversation_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON org_conversations, org_conversation_participants, org_messages
  TO vantage_app, vantage_worker;
GRANT EXECUTE ON FUNCTION can_access_org_conversation(uuid) TO vantage_app, vantage_worker;

-- Allow members to notify other org members about new DMs (existing policy only allows self-insert).
CREATE POLICY notifications_dm_peer_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'direct_message'
    AND org_id IS NOT NULL
    AND is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );
