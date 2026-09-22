-- Team chat moderation: members report, owners/admins remove.
--
-- Until now the only way a message left team chat was its author deleting it. A student who was
-- sent something unkind had nowhere to take it, and an owner who saw it could not take it down.
--
-- Two pieces:
--   * org_message_reports — any member who can see a message can report it (reason from a short
--     list, optional note). The reported text is snapshotted, so a report survives the author
--     deleting the message afterwards.
--   * org_messages.removed_* — an owner/admin removal is a soft delete that says who removed it
--     and why. Everyone else sees "Removed by a team admin"; the author sees that it was removed.
--
-- Youth protection (0455): nobody reviews a report about their own message. An owner/admin who
-- is the author cannot see, dismiss or action reports about it — another adult owner/admin has to.
-- That is the same "second adult" rule DMs follow, applied to moderation.

ALTER TABLE org_messages
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS removed_reason text
    CHECK (removed_reason IS NULL OR length(removed_reason) <= 500);

CREATE TABLE IF NOT EXISTS org_message_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES org_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES org_conversations(id) ON DELETE CASCADE,
  reporter_user_id uuid NOT NULL REFERENCES users(id),
  message_author_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL
    CHECK (reason IN ('harassment', 'inappropriate', 'spam', 'safety', 'other')),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  body_snapshot text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  resolution_note text CHECK (resolution_note IS NULL OR length(resolution_note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, reporter_user_id),
  CONSTRAINT org_message_reports_not_self CHECK (reporter_user_id <> message_author_id)
);

CREATE INDEX IF NOT EXISTS org_message_reports_org_status_idx
  ON org_message_reports (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS org_message_reports_message_idx
  ON org_message_reports (message_id);

ALTER TABLE org_message_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_message_reports_read ON org_message_reports;
DROP POLICY IF EXISTS org_message_reports_insert ON org_message_reports;
DROP POLICY IF EXISTS org_message_reports_resolve ON org_message_reports;

-- The reporter sees their own reports; owners/admins see every report except those about
-- their own messages.
CREATE POLICY org_message_reports_read ON org_message_reports FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      reporter_user_id = current_app_user_id()
      OR (
        has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
        AND message_author_id <> current_app_user_id()
      )
    )
  );

-- A member may report only a live message they can read, and the snapshot must be the real
-- text and the real author — checked against org_messages under the reporter's own RLS.
CREATE POLICY org_message_reports_insert ON org_message_reports FOR INSERT TO vantage_app
  WITH CHECK (
    reporter_user_id = current_app_user_id()
    AND is_org_member(org_id)
    AND status = 'open'
    AND resolved_by IS NULL
    AND can_access_org_conversation(conversation_id)
    AND EXISTS (
      SELECT 1 FROM org_messages m
      WHERE m.id = message_id
        AND m.org_id = org_message_reports.org_id
        AND m.conversation_id = org_message_reports.conversation_id
        AND m.author_user_id = org_message_reports.message_author_id
        AND m.body = org_message_reports.body_snapshot
        AND m.deleted_at IS NULL
    )
  );

CREATE POLICY org_message_reports_resolve ON org_message_reports FOR UPDATE TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    AND message_author_id <> current_app_user_id()
  )
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    AND message_author_id <> current_app_user_id()
    AND status IN ('dismissed', 'actioned')
    AND resolved_by = current_app_user_id()
  );

GRANT SELECT, INSERT, UPDATE ON org_message_reports TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_message_reports TO vantage_worker;

-- Owner/admin removal.
--
-- SECURITY DEFINER because an admin may act on a report about a private chat they are not in
-- (RLS rightly will not let them read or update that row directly). The function checks the
-- role itself, touches only the moderation columns, and never returns the message body.
CREATE OR REPLACE FUNCTION moderate_remove_org_message(p_message_id uuid, p_reason text)
RETURNS TABLE (message_id uuid, org_id uuid, author_user_id uuid, removed_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_author uuid;
  v_actor uuid := current_app_user_id();
  v_reason text := NULLIF(left(btrim(coalesce(p_reason, '')), 500), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT m.org_id, m.author_user_id INTO v_org, v_author
    FROM org_messages m
   WHERE m.id = p_message_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Message not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT has_org_role(v_org, ARRAY['owner', 'admin']::org_role[]) THEN
    RAISE EXCEPTION 'Only a team owner or admin can remove messages' USING ERRCODE = '42501';
  END IF;

  UPDATE org_messages m
     SET deleted_at = COALESCE(m.deleted_at, now()),
         removed_at = now(),
         removed_by = v_actor,
         removed_reason = v_reason,
         pinned_at = NULL,
         pinned_by = NULL,
         updated_at = now()
   WHERE m.id = p_message_id
     AND m.removed_at IS NULL;

  -- Reports about the remover's own message stay open for another adult to review.
  IF v_author <> v_actor THEN
    UPDATE org_message_reports r
       SET status = 'actioned',
           resolved_by = v_actor,
           resolved_at = now(),
           resolution_note = v_reason
     WHERE r.message_id = p_message_id
       AND r.status = 'open';
  END IF;

  RETURN QUERY
    SELECT m.id, m.org_id, m.author_user_id, m.removed_at
      FROM org_messages m
     WHERE m.id = p_message_id;
END;
$$;

REVOKE ALL ON FUNCTION moderate_remove_org_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION moderate_remove_org_message(uuid, text) TO vantage_app, vantage_worker;

-- Moderation notices for messages the caller can already see.
--
-- The removed_* columns ride on org_messages, whose RLS already limits a reader to their own
-- conversations. The reason is shown only to the author and to owners/admins; everyone else
-- learns only that a team admin removed it.
CREATE OR REPLACE FUNCTION org_message_removal_notices(p_org_id uuid, p_message_ids uuid[])
RETURNS TABLE (message_id uuid, removed_at timestamptz, reason text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT m.id,
         m.removed_at,
         CASE
           WHEN m.author_user_id = current_app_user_id()
             OR has_org_role(m.org_id, ARRAY['owner', 'admin']::org_role[])
           THEN m.removed_reason
           ELSE NULL
         END
    FROM org_messages m
   WHERE m.org_id = p_org_id
     AND m.id = ANY(p_message_ids)
     AND m.removed_at IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION org_message_removal_notices(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org_message_removal_notices(uuid, uuid[]) TO vantage_app, vantage_worker;
