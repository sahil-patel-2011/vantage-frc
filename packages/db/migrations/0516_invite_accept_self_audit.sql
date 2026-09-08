-- An invited scout/member/viewer could never join a team.
--
-- acceptOrganizationInvite() runs `SELECT accept_org_invite($1)` (SECURITY
-- DEFINER, so the membership row is written) and then, in the same transaction,
-- appends a `invite.accepted` row to membership_audit_events. That insert is
-- checked by membership_audit_actor_insert (0005, widened in 0049), which only
-- admits platform admins, org owner/admins, and holders of `manage_members`.
-- The person accepting an invite is by definition none of those unless the
-- invite itself was for owner/admin — so every scout/member/viewer accept threw
-- "new row violates row-level security policy for table membership_audit_events",
-- rolled back the membership, and returned "Invite could not be accepted".
--
-- Policies are OR'ed, so this adds the narrow self-accept case rather than
-- loosening the existing admin policy: the actor must be logging their own
-- accept, for the org they are now actually a member of, with that one action.

CREATE POLICY membership_audit_self_invite_accept ON membership_audit_events FOR INSERT TO vantage_app
  WITH CHECK (
    actor_user_id = current_app_user_id()
    AND action = 'invite.accepted'
    AND org_id IS NOT NULL
    AND is_org_member(org_id)
  );
