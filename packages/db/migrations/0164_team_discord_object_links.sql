-- CD #50: object-linked team messages + optional Discord chat bridge.
-- Extends alumni webhook (0113) with guild/channel ids and mirrors linked chat.

ALTER TABLE team_discord
  ADD COLUMN IF NOT EXISTS guild_id text,
  ADD COLUMN IF NOT EXISTS guild_name text,
  ADD COLUMN IF NOT EXISTS channel_id text,
  ADD COLUMN IF NOT EXISTS chat_bridge_enabled boolean NOT NULL DEFAULT false;

-- Bot-only links may omit a webhook; announcements/bridge then use DISCORD_BOT_TOKEN + channel_id.
ALTER TABLE team_discord ALTER COLUMN webhook_url DROP NOT NULL;

COMMENT ON COLUMN team_discord.guild_id IS 'Discord guild (server) snowflake; display + bot routing.';
COMMENT ON COLUMN team_discord.channel_id IS 'Discord channel snowflake for bot posts when DISCORD_BOT_TOKEN is set.';
COMMENT ON COLUMN team_discord.chat_bridge_enabled IS 'When true, object-linked team messages may mirror to Discord.';

CREATE TABLE IF NOT EXISTS org_message_object_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES org_messages(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  object_type text NOT NULL CHECK (
    object_type IN (
      'task',
      'cad_checkpoint',
      'inventory_item',
      'announcement',
      'event',
      'goal',
      'risk',
      'knowledge'
    )
  ),
  object_id text NOT NULL CHECK (length(trim(object_id)) > 0 AND length(object_id) <= 128),
  label text NOT NULL CHECK (length(trim(label)) > 0 AND length(label) <= 200),
  href text CHECK (href IS NULL OR length(href) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, object_type, object_id)
);

CREATE INDEX IF NOT EXISTS org_message_object_links_org_idx
  ON org_message_object_links(org_id, object_type, created_at DESC);

CREATE INDEX IF NOT EXISTS org_message_object_links_message_idx
  ON org_message_object_links(message_id);

ALTER TABLE org_message_object_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_message_object_links_member_read ON org_message_object_links;
CREATE POLICY org_message_object_links_member_read ON org_message_object_links FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM org_messages m
      WHERE m.id = message_id
        AND m.org_id = org_message_object_links.org_id
        AND can_access_org_conversation(m.conversation_id)
    )
  );

DROP POLICY IF EXISTS org_message_object_links_author_insert ON org_message_object_links;
CREATE POLICY org_message_object_links_author_insert ON org_message_object_links FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM org_messages m
      WHERE m.id = message_id
        AND m.org_id = org_message_object_links.org_id
        AND m.author_user_id = current_app_user_id()
        AND can_access_org_conversation(m.conversation_id)
    )
  );

DROP POLICY IF EXISTS org_message_object_links_author_delete ON org_message_object_links;
CREATE POLICY org_message_object_links_author_delete ON org_message_object_links FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM org_messages m
      WHERE m.id = message_id
        AND m.org_id = org_message_object_links.org_id
        AND m.author_user_id = current_app_user_id()
        AND can_access_org_conversation(m.conversation_id)
    )
  );

GRANT SELECT, INSERT, DELETE ON org_message_object_links TO vantage_app, vantage_worker;

CREATE TABLE IF NOT EXISTS discord_bridge_posts (
  message_id uuid PRIMARY KEY REFERENCES org_messages(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  discord_message_id text,
  posted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'failed', 'skipped')),
  error text
);

CREATE INDEX IF NOT EXISTS discord_bridge_posts_org_idx
  ON discord_bridge_posts(org_id, posted_at DESC);

ALTER TABLE discord_bridge_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS discord_bridge_posts_admin_all ON discord_bridge_posts;
CREATE POLICY discord_bridge_posts_admin_all ON discord_bridge_posts FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

DROP POLICY IF EXISTS discord_bridge_posts_author_insert ON discord_bridge_posts;
CREATE POLICY discord_bridge_posts_author_insert ON discord_bridge_posts FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM org_messages m
      WHERE m.id = message_id
        AND m.org_id = discord_bridge_posts.org_id
        AND m.author_user_id = current_app_user_id()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON discord_bridge_posts TO vantage_app, vantage_worker;
