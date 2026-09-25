-- Owners and admins hear when someone they invited joins.
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
