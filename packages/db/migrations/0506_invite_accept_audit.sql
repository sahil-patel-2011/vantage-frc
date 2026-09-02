-- Accepting an invite is the one membership event written by the invitee, not
-- an admin: accept_org_invite() (SECURITY DEFINER) has already granted the
-- membership inside the same transaction, but the audit insert that follows
-- ran under the request role and was refused by the owner/admin-only policy —
-- so every self-service accept failed with a generic 400. Allow a member to
-- log exactly that action about themselves.

DROP POLICY IF EXISTS membership_audit_actor_insert ON membership_audit_events;
CREATE POLICY membership_audit_actor_insert ON membership_audit_events FOR INSERT TO vantage_app
  WITH CHECK (
    actor_user_id = current_app_user_id()
    AND (
      is_platform_admin()
      OR (
        org_id IS NOT NULL
        AND (
          has_org_role(org_id, ARRAY['owner','admin']::org_role[])
          OR has_org_capability(org_id, 'manage_members'::org_capability)
          OR (action = 'invite.accepted' AND is_org_member(org_id))
        )
      )
    )
  );
