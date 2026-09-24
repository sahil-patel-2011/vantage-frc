-- Join the team you were invited to, without the link from the invite email.
--
-- An invited owner or student who signed in on /signin (not through the invite link) reached
-- onboarding, where the app already knew about their invite (onboarding_workspace_for_current_user
-- reports 'invited') but could only say "open the invitation email". The /invite page it pointed
-- to had no token, so it was a loop with no way forward.
--
-- Signing in with an emailed code (or Google) already proves the person controls that address,
-- which is exactly what the invite link proves. So this accepts the newest pending, unexpired
-- invite for the current user's verified email to the given team, with the same checks and
-- effects as accept_org_invite(token) in 0005: verified email required, exact email match,
-- expiry honoured, membership with the invited role, invite marked accepted.

CREATE OR REPLACE FUNCTION accept_my_org_invite(target_org uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  candidate invites%ROWTYPE;
  app_user users%ROWTYPE;
BEGIN
  SELECT * INTO app_user FROM users WHERE id = current_app_user_id();
  IF app_user.id IS NULL OR NOT app_user.email_verified THEN
    RAISE EXCEPTION 'A verified email is required';
  END IF;

  SELECT * INTO candidate FROM invites
   WHERE org_id = target_org
     AND lower(email) = lower(app_user.email)
     AND status = 'pending'
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF candidate.id IS NULL THEN
    RAISE EXCEPTION 'Invite is invalid or already used';
  END IF;
  IF candidate.expires_at <= now() THEN
    UPDATE invites SET status = 'expired' WHERE id = candidate.id;
    RAISE EXCEPTION 'Invite has expired';
  END IF;

  INSERT INTO memberships(org_id, user_id, role)
    VALUES (candidate.org_id, app_user.id, candidate.role)
    ON CONFLICT (org_id, user_id) DO NOTHING;
  UPDATE invites SET status = 'accepted', accepted_by = app_user.id, accepted_at = now()
   WHERE id = candidate.id;
  RETURN candidate.org_id;
END $$;

REVOKE ALL ON FUNCTION accept_my_org_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_my_org_invite(uuid) TO vantage_app;
