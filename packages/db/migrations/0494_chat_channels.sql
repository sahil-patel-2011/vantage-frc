-- Team chat channels.
--
-- 0032 shipped one hard-coded "Team" conversation per org plus DMs. A team that lives in chat
-- needs more than that: an announcements channel only mentors/admins can post in, one channel per
-- subteam, explicit channel membership with a per-member read cursor, and an audit trail for
-- edits and deletes ("deleted" must not mean "gone" -- see 0455). This migration adds all of it
-- on top of org_conversations rather than beside it, so DMs, supervision, pins, mentions, object
-- links and the Slack/Discord bridges keep working unchanged.
--
--   * org_conversations gains slug / description / subteam_id / archived_at and two new kinds:
--     'announce' (post = owner/admin/mentor/coach only) and 'subteam'.
--   * org_conversation_members: who is in a channel, their channel role, and last_read_at.
--     DMs keep using org_conversation_participants.
--   * org_message_revisions: prior body on every edit or delete, actor and time.
--   * org_notification_targets(): SECURITY DEFINER fan-out helper so one INSERT ... SELECT can
--     notify every member whose in-app prefs allow it. profiles is self-read-only under RLS
--     (0001), so the request role could never honour a teammate's opt-out row-by-row.
--
-- Backfill: the existing "Team" conversation becomes slug 'general' and every current org member
-- gets a member row in it (read cursor carried over from org_conversation_participants).

-- ---------------------------------------------------------------------------------------------
-- org_conversations: new columns and kinds
-- ---------------------------------------------------------------------------------------------
ALTER TABLE org_conversations
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS subteam_id uuid REFERENCES team_subteams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);

ALTER TABLE org_conversations DROP CONSTRAINT IF EXISTS org_conversations_kind_check;
ALTER TABLE org_conversations ADD CONSTRAINT org_conversations_kind_check
  CHECK (kind IN ('team', 'dm', 'announce', 'subteam'));

ALTER TABLE org_conversations DROP CONSTRAINT IF EXISTS org_conversations_kind_shape_chk;
ALTER TABLE org_conversations ADD CONSTRAINT org_conversations_kind_shape_chk CHECK (
  (kind IN ('team', 'announce', 'subteam')
    AND title IS NOT NULL AND length(trim(title)) > 0 AND dm_key IS NULL)
  OR (kind = 'dm' AND title IS NULL AND dm_key IS NOT NULL)
);

ALTER TABLE org_conversations DROP CONSTRAINT IF EXISTS org_conversations_slug_shape_chk;
ALTER TABLE org_conversations ADD CONSTRAINT org_conversations_slug_shape_chk CHECK (
  slug IS NULL OR slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'
);

ALTER TABLE org_conversations DROP CONSTRAINT IF EXISTS org_conversations_subteam_kind_chk;
ALTER TABLE org_conversations ADD CONSTRAINT org_conversations_subteam_kind_chk CHECK (
  subteam_id IS NULL OR kind = 'subteam'
);

CREATE UNIQUE INDEX IF NOT EXISTS org_conversations_slug_uq
  ON org_conversations(org_id, slug)
  WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS org_conversations_org_channels_idx
  ON org_conversations(org_id, kind, archived_at)
  WHERE kind <> 'dm';

-- ---------------------------------------------------------------------------------------------
-- org_messages: edit marker
-- ---------------------------------------------------------------------------------------------
ALTER TABLE org_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- Channel membership
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_conversation_members (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES org_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator')),
  last_read_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS org_conversation_members_user_idx
  ON org_conversation_members(org_id, user_id, conversation_id);

ALTER TABLE org_conversation_members ENABLE ROW LEVEL SECURITY;

-- A member sees their own rows; owners/admins and channel moderators see everyone in the org.
DROP POLICY IF EXISTS org_conversation_members_read ON org_conversation_members;
CREATE POLICY org_conversation_members_read ON org_conversation_members FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      user_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])
      OR is_platform_admin()
      OR EXISTS (
        SELECT 1 FROM org_conversation_members mod
        WHERE mod.conversation_id = org_conversation_members.conversation_id
          AND mod.user_id = current_app_user_id()
          AND mod.role = 'moderator'
      )
    )
  );

-- Join yourself; owners/admins, moderators and the channel's creator may add others (creating a
-- subteam channel seeds its members, creating an announce channel seeds the whole org).
DROP POLICY IF EXISTS org_conversation_members_insert ON org_conversation_members;
CREATE POLICY org_conversation_members_insert ON org_conversation_members FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM org_conversations c
      WHERE c.id = conversation_id
        AND c.org_id = org_conversation_members.org_id
        AND c.kind <> 'dm'
    )
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = org_conversation_members.org_id AND m.user_id = org_conversation_members.user_id
    )
    AND (
      user_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])
      OR EXISTS (
        SELECT 1 FROM org_conversations c
        WHERE c.id = conversation_id AND c.created_by = current_app_user_id()
      )
      OR EXISTS (
        SELECT 1 FROM org_conversation_members mod
        WHERE mod.conversation_id = org_conversation_members.conversation_id
          AND mod.user_id = current_app_user_id()
          AND mod.role = 'moderator'
      )
    )
  );

DROP POLICY IF EXISTS org_conversation_members_update ON org_conversation_members;
CREATE POLICY org_conversation_members_update ON org_conversation_members FOR UPDATE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      user_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])
      OR EXISTS (
        SELECT 1 FROM org_conversation_members mod
        WHERE mod.conversation_id = org_conversation_members.conversation_id
          AND mod.user_id = current_app_user_id()
          AND mod.role = 'moderator'
      )
    )
  )
  WITH CHECK (is_org_member(org_id));

DROP POLICY IF EXISTS org_conversation_members_delete ON org_conversation_members;
CREATE POLICY org_conversation_members_delete ON org_conversation_members FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      user_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])
      OR EXISTS (
        SELECT 1 FROM org_conversation_members mod
        WHERE mod.conversation_id = org_conversation_members.conversation_id
          AND mod.user_id = current_app_user_id()
          AND mod.role = 'moderator'
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON org_conversation_members TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------------------------------------
-- Edit / delete audit trail
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_message_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES org_messages(id) ON DELETE CASCADE,
  prior_body text NOT NULL,
  action text NOT NULL CHECK (action IN ('edit', 'delete')),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_message_revisions_message_idx
  ON org_message_revisions(message_id, created_at ASC);
CREATE INDEX IF NOT EXISTS org_message_revisions_org_idx
  ON org_message_revisions(org_id, created_at DESC);

ALTER TABLE org_message_revisions ENABLE ROW LEVEL SECURITY;

-- Prior bodies are visible to the person who made the change and to owners/admins (the same
-- people who can run the audited transcript export). Everyone else sees only "(edited)".
DROP POLICY IF EXISTS org_message_revisions_read ON org_message_revisions;
CREATE POLICY org_message_revisions_read ON org_message_revisions FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      actor_user_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])
      OR is_platform_admin()
    )
  );

-- Only the message author can change a message (org_messages_author_soft_delete), so the actor
-- of a revision is always the author writing about their own message.
DROP POLICY IF EXISTS org_message_revisions_insert ON org_message_revisions;
CREATE POLICY org_message_revisions_insert ON org_message_revisions FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND actor_user_id = current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM org_messages m
      WHERE m.id = message_id
        AND m.org_id = org_message_revisions.org_id
        AND m.author_user_id = current_app_user_id()
        AND can_access_org_conversation(m.conversation_id)
    )
  );

-- Append-only for the request role: a revision cannot be edited or removed by anyone in-app.
GRANT SELECT, INSERT ON org_message_revisions TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_message_revisions TO vantage_worker;

-- ---------------------------------------------------------------------------------------------
-- Visibility: every non-DM channel is visible to every org member (they have to be able to see a
-- channel to join it). DMs stay participant-only.
-- ---------------------------------------------------------------------------------------------
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
        c.kind <> 'dm'
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

DROP POLICY IF EXISTS org_conversations_member_read ON org_conversations;
CREATE POLICY org_conversations_member_read ON org_conversations FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      kind <> 'dm'
      OR EXISTS (
        SELECT 1 FROM org_conversation_participants p
        WHERE p.conversation_id = id AND p.user_id = current_app_user_id()
      )
      OR is_platform_admin()
    )
  );

DROP POLICY IF EXISTS org_conversations_member_update ON org_conversations;
CREATE POLICY org_conversations_member_update ON org_conversations FOR UPDATE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      kind <> 'dm'
      OR EXISTS (
        SELECT 1 FROM org_conversation_participants p
        WHERE p.conversation_id = id AND p.user_id = current_app_user_id()
      )
    )
  )
  WITH CHECK (is_org_member(org_id));

-- ---------------------------------------------------------------------------------------------
-- Who may post announcements / manage channels: org owner/admin, or a member whose stated team
-- role is mentor or coach. profiles.team_role is self-read-only, hence SECURITY DEFINER; the
-- function discloses one boolean about one member to a fellow org member, nothing more.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org_chat_can_announce(p_org_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (is_org_member(p_org_id) OR is_platform_admin() OR current_app_user_id() IS NULL)
    AND EXISTS (
      SELECT 1
      FROM memberships m
      LEFT JOIN profiles p ON p.user_id = m.user_id
      WHERE m.org_id = p_org_id
        AND m.user_id = p_user_id
        AND (m.role IN ('owner', 'admin') OR p.team_role IN ('mentor', 'coach'))
    )
$$;

-- Enforced at the table, not only in the route: an announce channel never accepts a post from
-- someone without the role, and an archived channel accepts nothing, whichever code path writes.
CREATE OR REPLACE FUNCTION org_messages_channel_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind text;
  v_archived timestamptz;
BEGIN
  SELECT c.kind, c.archived_at INTO v_kind, v_archived
  FROM org_conversations c
  WHERE c.id = NEW.conversation_id;

  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived and no longer accepts messages'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_kind = 'announce' AND NOT org_chat_can_announce(NEW.org_id, NEW.author_user_id) THEN
    RAISE EXCEPTION 'Only mentors and team admins can post in an announcement channel'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_messages_channel_guard ON org_messages;
CREATE TRIGGER org_messages_channel_guard
  BEFORE INSERT ON org_messages
  FOR EACH ROW EXECUTE FUNCTION org_messages_channel_guard();

-- ---------------------------------------------------------------------------------------------
-- Set-based notification fan-out. Returns the org members whose in-app prefs allow p_pref_key
-- (NULL = no preference gate), optionally restricted to one channel's members. Used by
-- emitNotificationToOrgMembers() in @vantage/core so a chat send is one INSERT, not N.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org_notification_targets(
  p_org_id uuid,
  p_pref_key text,
  p_conversation_id uuid DEFAULT NULL
)
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id
  FROM memberships m
  LEFT JOIN profiles p ON p.user_id = m.user_id
  WHERE (is_org_member(p_org_id) OR is_platform_admin() OR current_app_user_id() IS NULL)
    AND m.org_id = p_org_id
    AND (
      p_pref_key IS NULL
      OR COALESCE((p.notification_prefs->>p_pref_key)::boolean, true) IS TRUE
    )
    AND (
      p_conversation_id IS NULL
      OR EXISTS (
        SELECT 1 FROM org_conversation_members cm
        WHERE cm.conversation_id = p_conversation_id AND cm.user_id = m.user_id
      )
    )
$$;

-- ---------------------------------------------------------------------------------------------
-- Transcript export: revisions for one member's DM history, same authorisation as
-- org_member_dm_export (0455). Owner/admin only, and the route audits every call.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org_member_dm_revisions(p_org_id uuid, p_member_user_id uuid)
RETURNS TABLE (
  conversation_id uuid,
  message_id uuid,
  action text,
  prior_body text,
  actor_user_id uuid,
  actor_name text,
  revised_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    m.conversation_id,
    r.message_id,
    r.action,
    r.prior_body,
    r.actor_user_id,
    COALESCE(au.name, 'Member') AS actor_name,
    r.created_at AS revised_at
  FROM org_message_revisions r
  INNER JOIN org_messages m ON m.id = r.message_id
  INNER JOIN org_conversations c ON c.id = m.conversation_id
  LEFT JOIN users au ON au.id = r.actor_user_id
  WHERE has_org_role(p_org_id, ARRAY['owner','admin']::org_role[])
    AND c.org_id = p_org_id
    AND c.kind = 'dm'
    AND EXISTS (
      SELECT 1 FROM memberships mm
      WHERE mm.org_id = p_org_id AND mm.user_id = p_member_user_id
    )
    AND EXISTS (
      SELECT 1 FROM org_conversation_participants p
      WHERE p.conversation_id = c.id AND p.user_id = p_member_user_id
    )
  ORDER BY m.conversation_id, m.created_at ASC, r.created_at ASC
$$;

REVOKE ALL ON FUNCTION org_chat_can_announce(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION org_notification_targets(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION org_member_dm_revisions(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org_chat_can_announce(uuid, uuid), org_notification_targets(uuid, text, uuid),
  org_member_dm_revisions(uuid, uuid) TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------------------------
-- 1. The org's "Team" conversation is #general.
UPDATE org_conversations c
SET slug = 'general'
WHERE c.kind = 'team'
  AND c.slug IS NULL
  AND lower(c.title) = 'team'
  AND NOT EXISTS (
    SELECT 1 FROM org_conversations o WHERE o.org_id = c.org_id AND o.slug = 'general'
  );

-- 2. Any other pre-existing team channel gets a slug derived from its title (deduplicated).
WITH candidates AS (
  SELECT id, org_id,
         left(NULLIF(btrim(regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'), '-'), ''), 36) AS base
  FROM org_conversations
  WHERE kind <> 'dm' AND slug IS NULL AND title IS NOT NULL
),
numbered AS (
  SELECT id, org_id, base, row_number() OVER (PARTITION BY org_id, base ORDER BY id) AS n
  FROM candidates
  WHERE base IS NOT NULL
),
proposed AS (
  SELECT id, org_id, CASE WHEN n = 1 THEN base ELSE base || '-' || n END AS slug
  FROM numbered
)
UPDATE org_conversations c
SET slug = p.slug
FROM proposed p
WHERE p.id = c.id
  AND NOT EXISTS (
    SELECT 1 FROM org_conversations o WHERE o.org_id = p.org_id AND o.slug = p.slug
  );

-- 3. Every current org member is a member of #general, keeping the read cursor they already had.
INSERT INTO org_conversation_members (org_id, conversation_id, user_id, role, last_read_at, joined_at)
SELECT c.org_id,
       c.id,
       m.user_id,
       CASE WHEN m.role IN ('owner', 'admin') THEN 'moderator' ELSE 'member' END,
       p.last_read_at,
       COALESCE(p.joined_at, m.created_at, now())
FROM org_conversations c
INNER JOIN memberships m ON m.org_id = c.org_id
LEFT JOIN org_conversation_participants p
  ON p.conversation_id = c.id AND p.user_id = m.user_id
WHERE c.kind = 'team' AND c.slug = 'general'
ON CONFLICT (conversation_id, user_id) DO NOTHING;

COMMENT ON TABLE org_conversation_members IS
  'Channel membership + read cursor for team/announce/subteam conversations. DMs use org_conversation_participants.';
COMMENT ON TABLE org_message_revisions IS
  'Prior body of every chat edit/delete. Append-only for the request role; surfaced in the audited DM export.';
COMMENT ON FUNCTION org_chat_can_announce(uuid, uuid) IS
  'Owner/admin org role, or mentor/coach team role: may post announcements and manage channels.';
