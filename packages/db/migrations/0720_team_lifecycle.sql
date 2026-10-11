-- Team lifecycle: a member leaves a team, an owner deletes one, and anyone deletes their own
-- account. Renaming needs nothing new: organizations_admin_profile_update already lets an owner or
-- admin change the name through withRls.
--
-- The three actions cross tables the request role cannot write for someone else (other people's
-- inboxes, the platform audit, the account row Better Auth owns), so each is one narrow
-- SECURITY DEFINER function that checks the caller itself, the same shape as accept_org_invite.
-- The routes check first and say why in plain words; these checks are the backstop.

-- A deleted team keeps its line in the platform audit. The foreign key used to block the delete
-- outright (it was the only reference to organizations without ON DELETE), because provisioning
-- writes admin_actions for every team.
ALTER TABLE admin_actions DROP CONSTRAINT IF EXISTS admin_actions_target_org_id_fkey;
ALTER TABLE admin_actions ADD CONSTRAINT admin_actions_target_org_id_fkey
  FOREIGN KEY (target_org_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- One person leaving one team: their access, their own state in that team, an audit line, and a
-- note to the people who run the team. Called only by the functions below (no EXECUTE grant).
CREATE FUNCTION team_member_departure(p_org uuid, p_user uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  previous_role org_role;
  person text;
BEGIN
  DELETE FROM memberships WHERE org_id = p_org AND user_id = p_user RETURNING role INTO previous_role;
  IF previous_role IS NULL THEN RETURN; END IF;
  -- Access first: nothing that grants this person anything in the team may outlive the membership.
  DELETE FROM membership_capabilities WHERE org_id = p_org AND user_id = p_user;
  DELETE FROM membership_hub_access WHERE org_id = p_org AND user_id = p_user;
  -- Tokens and keys that would otherwise keep working without a session.
  DELETE FROM calendar_feed_tokens WHERE org_id = p_org AND user_id = p_user;
  DELETE FROM member_llm_keys WHERE org_id = p_org AND user_id = p_user;
  DELETE FROM push_subscriptions WHERE org_id = p_org AND user_id = p_user;
  -- Their own state in this team. Team work they made (scouting, tasks, files) stays with the team.
  DELETE FROM dashboards WHERE org_id = p_org AND owner_user_id = p_user AND scope = 'personal';
  DELETE FROM member_onboarding_checks WHERE org_id = p_org AND user_id = p_user;
  DELETE FROM member_onboarding_tracks WHERE org_id = p_org AND user_id = p_user;
  DELETE FROM notifications WHERE org_id = p_org AND user_id = p_user;
  DELETE FROM agent_threads WHERE org_id = p_org AND created_by = p_user AND scope = 'private';

  INSERT INTO membership_audit_events(org_id, actor_user_id, action, metadata)
    VALUES (p_org, p_user, 'member.left', jsonb_build_object('role', previous_role, 'reason', p_reason));

  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(u.name), ''), 'A team member')
    INTO person FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = p_user;
  INSERT INTO notifications(user_id, org_id, type, payload)
  SELECT m.user_id, p_org, 'member_left', jsonb_build_object(
      'title', CASE WHEN p_reason = 'account_deleted' THEN 'A team member deleted their account'
                    ELSE COALESCE(person, 'A team member') || ' left the team' END,
      'body', 'Their access ended. Work they added stays with the team.',
      'href', '/team/admin?orgId=' || p_org::text)
    FROM memberships m
   WHERE m.org_id = p_org AND m.role IN ('owner', 'admin');
END $$;
REVOKE ALL ON FUNCTION team_member_departure(uuid, uuid, text) FROM PUBLIC;

-- Leave a team. Anyone may, except the last owner: a team must always have someone who can run it,
-- so the owner hands the team over first (Team admin › Hand over team).
CREATE FUNCTION leave_team(p_org uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  my_role org_role;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501'; END IF;
  -- The same lock every role change takes (lockTeamAdministration), so a hand-over and a leave
  -- cannot both see "another owner exists".
  PERFORM 1 FROM organizations WHERE id = p_org FOR UPDATE;
  SELECT role INTO my_role FROM memberships WHERE org_id = p_org AND user_id = actor FOR UPDATE;
  IF my_role IS NULL THEN
    RAISE EXCEPTION 'You are not on this team' USING ERRCODE = '42501', DETAIL = 'vantage:not_a_member';
  END IF;
  IF my_role = 'owner' AND NOT EXISTS (
    SELECT 1 FROM memberships WHERE org_id = p_org AND role = 'owner' AND user_id <> actor
  ) THEN
    RAISE EXCEPTION 'Hand the team over before you leave' USING ERRCODE = '42501', DETAIL = 'vantage:last_owner';
  END IF;
  PERFORM team_member_departure(p_org, actor, 'left');
END $$;
REVOKE ALL ON FUNCTION leave_team(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION leave_team(uuid) TO vantage_app;

-- Whether a paid plan is still billing this team. Deleting the team would leave Stripe charging a
-- card for a team that no longer exists, so the plan is cancelled first.
CREATE FUNCTION team_has_live_subscription(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
      SELECT 1 FROM org_entitlements
       WHERE org_id = p_org AND stripe_subscription_id IS NOT NULL
         AND status NOT IN ('canceled', 'incomplete_expired'))
    OR EXISTS (
      SELECT 1 FROM billing_accounts a JOIN billing_subscriptions s ON s.billing_account_id = a.id
       WHERE a.owner_org_id = p_org AND s.stripe_subscription_id IS NOT NULL
         AND s.status NOT IN ('canceled', 'incomplete_expired'))
$$;
REVOKE ALL ON FUNCTION team_has_live_subscription(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION team_has_live_subscription(uuid) TO vantage_app;

-- Delete a team and everything in it. The team's owner may, and so may a platform admin (a team
-- created by mistake, or one whose owner never joined). p_confirm is what the person typed: the
-- team number, or the name for a team without one. Every team table cascades from organizations.
CREATE FUNCTION delete_team(p_org uuid, p_confirm text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  target organizations%ROWTYPE;
  by_platform boolean;
  label text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501'; END IF;
  SELECT * INTO target FROM organizations WHERE id = p_org FOR UPDATE;
  IF target.id IS NULL THEN
    RAISE EXCEPTION 'Team not found' USING ERRCODE = 'P0002', DETAIL = 'vantage:not_found';
  END IF;
  by_platform := NOT EXISTS (SELECT 1 FROM memberships WHERE org_id = p_org AND user_id = actor AND role = 'owner');
  IF by_platform AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Only the team owner can delete the team' USING ERRCODE = '42501', DETAIL = 'vantage:not_owner';
  END IF;
  IF btrim(COALESCE(p_confirm, '')) <> COALESCE(target.team_number::text, btrim(target.name)) THEN
    RAISE EXCEPTION 'Type the team number to confirm' USING ERRCODE = '22023', DETAIL = 'vantage:confirm_mismatch';
  END IF;
  IF team_has_live_subscription(p_org) THEN
    RAISE EXCEPTION 'Cancel the paid plan first' USING ERRCODE = '55000', DETAIL = 'vantage:paid_plan';
  END IF;

  label := CASE WHEN target.team_number IS NULL THEN btrim(target.name)
                ELSE 'Team ' || target.team_number || CASE WHEN btrim(target.name) IN ('', 'Team ' || target.team_number)
                                                          THEN '' ELSE ' · ' || btrim(target.name) END END;
  -- Everyone else on the team hears why it is gone. No org_id: the team's own inbox goes with it.
  INSERT INTO notifications(user_id, org_id, type, payload)
  SELECT m.user_id, NULL, 'team_deleted', jsonb_build_object(
      'title', label || ' was deleted',
      'body', CASE WHEN by_platform THEN 'Vantage removed this team and its data. Ask your team lead if you have questions.'
                   ELSE 'The team owner deleted the team and its data. Ask them if you have questions.' END,
      'href', '/account/teams')
    FROM memberships m
   WHERE m.org_id = p_org AND m.user_id <> actor;

  INSERT INTO admin_actions(actor_user_id, action, target_org_id, payload)
    VALUES (actor, 'organization.deleted', NULL, jsonb_build_object(
      'orgId', p_org, 'teamNumber', target.team_number, 'name', target.name,
      'by', CASE WHEN by_platform THEN 'platform_admin' ELSE 'owner' END,
      'members', (SELECT count(*) FROM memberships WHERE org_id = p_org)));

  -- Cascaded deletes run the team's own row triggers. With a person attached, the finance guards
  -- would ask whether that person may still change money in a team that is half gone; the
  -- deletion is the system's, so it runs with no person attached, as the worker does.
  PERFORM set_config('app.user_id', '', true);
  DELETE FROM organizations WHERE id = p_org;
  PERFORM set_config('app.user_id', actor::text, true);
END $$;
REVOKE ALL ON FUNCTION delete_team(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_team(uuid, text) TO vantage_app;

-- Delete your own account. p_confirm is your email address as you typed it.
--
-- What goes: every team membership (as if you left each team), sign-in methods and sessions,
-- profile and settings, personal keys and devices, notifications, private Ask AI threads and the
-- prompts stored with them, waitlist rows and invites addressed to you. What stays: team work you
-- made (scouting, tasks, files, hours, money records), which the team owns. The account row is kept
-- without a name or a usable email so those records keep their links; nobody can sign in as it.
CREATE FUNCTION delete_my_account(p_confirm text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  me users%ROWTYPE;
  team record;
  personal record;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501'; END IF;
  SELECT * INTO me FROM users WHERE id = actor FOR UPDATE;
  IF me.id IS NULL THEN RAISE EXCEPTION 'Account not found' USING ERRCODE = 'P0002', DETAIL = 'vantage:not_found'; END IF;
  IF lower(btrim(COALESCE(p_confirm, ''))) <> lower(btrim(me.email)) THEN
    RAISE EXCEPTION 'Type your email address to confirm' USING ERRCODE = '22023', DETAIL = 'vantage:confirm_mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM platform_admins WHERE user_id = actor) THEN
    RAISE EXCEPTION 'Platform admins cannot delete their account here' USING ERRCODE = '42501', DETAIL = 'vantage:platform_admin';
  END IF;
  IF EXISTS (
    SELECT 1 FROM memberships m
     WHERE m.user_id = actor AND m.role = 'owner'
       AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.org_id = m.org_id AND o.role = 'owner' AND o.user_id <> actor)
  ) THEN
    RAISE EXCEPTION 'Hand over or delete your team first' USING ERRCODE = '42501', DETAIL = 'vantage:last_owner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM billing_accounts a JOIN billing_subscriptions s ON s.billing_account_id = a.id
     WHERE a.owner_user_id = actor AND s.stripe_subscription_id IS NOT NULL
       AND s.status NOT IN ('canceled', 'incomplete_expired')
  ) THEN
    RAISE EXCEPTION 'Cancel your personal plan first' USING ERRCODE = '55000', DETAIL = 'vantage:paid_plan';
  END IF;

  FOR team IN SELECT org_id FROM memberships WHERE user_id = actor ORDER BY created_at LOOP
    PERFORM 1 FROM organizations WHERE id = team.org_id FOR UPDATE;
    PERFORM team_member_departure(team.org_id, actor, 'account_deleted');
  END LOOP;

  -- Private Ask AI: the threads (messages go with them) and the prompts and answers kept on runs.
  DELETE FROM agent_threads WHERE created_by = actor AND scope = 'private';
  UPDATE ai_runs SET input = '{}'::jsonb, output = NULL, context_sources = '[]'::jsonb
   WHERE user_id = actor AND privacy_scope = 'private';

  -- Everything the schema already marks as this person's own (ON DELETE CASCADE from users) and
  -- that is not team work: tables with no team at all, and team tables listed as a person's own
  -- state (view_only_exempt_tables). New personal tables are covered without editing this.
  FOR personal IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass AND c.confdeltype = 'c'
       AND array_length(c.conkey, 1) = 1
       AND c.conrelid <> 'platform_admins'::regclass
       AND (
         NOT EXISTS (SELECT 1 FROM pg_attribute o WHERE o.attrelid = c.conrelid AND o.attname = 'org_id' AND NOT o.attisdropped)
         OR EXISTS (SELECT 1 FROM view_only_exempt_tables e WHERE e.table_name = c.conrelid::regclass::text)
       )
  LOOP
    EXECUTE format('DELETE FROM %s WHERE %I = $1', personal.tbl, personal.col) USING actor;
  END LOOP;

  -- Addressed to this email: unanswered invites, the waitlist and pending sign-in codes.
  DELETE FROM invites WHERE lower(email) = lower(me.email) AND status <> 'accepted';
  UPDATE invites SET email = 'deleted-' || actor::text || '@deleted.invalid' WHERE lower(email) = lower(me.email);
  DELETE FROM waitlist_signups WHERE email_normalized = lower(btrim(me.email));
  -- Better Auth names a pending code '<type>-otp-<email>'; match the whole address, so nobody whose
  -- address merely contains this one loses their code.
  DELETE FROM verifications
   WHERE right(lower(identifier), length(btrim(me.email)) + 5) = '-otp-' || lower(btrim(me.email));

  INSERT INTO auth_audit_events(action, email_hash, user_id, success, metadata)
    VALUES ('account.deleted', encode(digest(lower(btrim(me.email)), 'sha256'), 'hex'), actor, true, '{}'::jsonb);

  UPDATE users
     SET name = 'Former member',
         email = 'deleted-' || actor::text || '@deleted.invalid',
         email_verified = false,
         avatar_url = NULL,
         updated_at = now()
   WHERE id = actor;
END $$;
REVOKE ALL ON FUNCTION delete_my_account(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_my_account(text) TO vantage_app;
