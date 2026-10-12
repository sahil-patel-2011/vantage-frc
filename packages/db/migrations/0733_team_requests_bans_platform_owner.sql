-- Three things the platform operator asked for, in one place because they share the same checks.
--
-- 1. Team requests. Typing a team number that is not on Vantage yet (or a team nobody leads yet)
--    used to end at "nobody has set up this team" and a first-come-first-served /claim. Now it is a
--    request the platform admins review: approving it creates the team with the requester as its
--    owner. Anyone else who asked for the same team is forwarded to that owner.
-- 2. Team bans. The platform owner can bar an FRC team number for breaking the Terms of Service or
--    the Privacy Policy. A banned number cannot be requested, created or joined, and an existing
--    team with that number is locked: its members stop seeing it until the ban is lifted. Nothing
--    is deleted.
-- 3. One platform owner. The first platform admin is the owner. Only the owner adds or removes
--    platform admins, bans teams, and can never be removed by anyone else (handing over is a
--    transfer).
--
-- Everything that writes is a narrow SECURITY DEFINER function that checks the caller itself, the
-- same shape as 0720 and 0727: the request role cannot write these tables directly.

-- ---------------------------------------------------------------------------------------------
-- 1. The platform owner
-- ---------------------------------------------------------------------------------------------

ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS platform_admins_single_owner ON platform_admins (is_owner) WHERE is_owner;

-- Whoever has held Platform admin longest is the owner. On a fresh database the first admin added
-- becomes the owner (trigger below).
UPDATE platform_admins SET is_owner = true
 WHERE user_id = (SELECT user_id FROM platform_admins ORDER BY granted_at, user_id LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM platform_admins WHERE is_owner);

CREATE OR REPLACE FUNCTION platform_admins_first_is_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE is_owner) THEN
    NEW.is_owner := true;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS platform_admins_first_is_owner ON platform_admins;
CREATE TRIGGER platform_admins_first_is_owner BEFORE INSERT ON platform_admins
  FOR EACH ROW EXECUTE FUNCTION platform_admins_first_is_owner();

CREATE OR REPLACE FUNCTION is_platform_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = current_app_user_id() AND is_owner)
$$;
REVOKE ALL ON FUNCTION is_platform_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_platform_owner() TO vantage_app;

-- The list now says who the owner is.
DROP FUNCTION IF EXISTS platform_admin_list();
CREATE FUNCTION platform_admin_list()
RETURNS TABLE (user_id uuid, email text, name text, granted_at timestamptz, granted_by_email text, is_owner boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = '42501', DETAIL = 'vantage:not_platform_admin';
  END IF;
  RETURN QUERY
    SELECT p.user_id, u.email, COALESCE(NULLIF(btrim(pr.display_name), ''), NULLIF(btrim(u.name), ''), u.email),
           p.granted_at, g.email, p.is_owner
      FROM platform_admins p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN profiles pr ON pr.user_id = p.user_id
      LEFT JOIN users g ON g.id = p.granted_by
     ORDER BY p.is_owner DESC, p.granted_at, u.email;
END $$;
REVOKE ALL ON FUNCTION platform_admin_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_list() TO vantage_app;

-- Only the owner adds platform admins.
CREATE OR REPLACE FUNCTION platform_admin_add(p_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  target uuid;
BEGIN
  IF actor IS NULL OR NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = '42501', DETAIL = 'vantage:not_platform_admin';
  END IF;
  IF NOT is_platform_owner() THEN
    RAISE EXCEPTION 'Only the platform owner can add platform admins' USING ERRCODE = '42501', DETAIL = 'vantage:owner_only';
  END IF;
  LOCK TABLE platform_admins IN SHARE ROW EXCLUSIVE MODE;
  target := platform_admin_target(p_email);
  IF EXISTS (SELECT 1 FROM platform_admins WHERE user_id = target) THEN
    RAISE EXCEPTION 'That person is already a platform admin' USING ERRCODE = '23505', DETAIL = 'vantage:already_admin';
  END IF;
  INSERT INTO platform_admins(user_id, granted_by) VALUES (target, actor);
  INSERT INTO admin_actions(actor_user_id, action, target_user_id, payload)
    VALUES (actor, 'platform_admin.added', target, jsonb_build_object('email', lower(btrim(p_email))));
  PERFORM platform_admin_welcome(target, actor, false);
  RETURN target;
END $$;

-- The owner removes anyone but themselves; another admin may only step down. The owner's row
-- leaves only through a transfer, so Vantage always has an owner.
CREATE OR REPLACE FUNCTION platform_admin_remove(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  target_email text;
BEGIN
  IF actor IS NULL OR NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = '42501', DETAIL = 'vantage:not_platform_admin';
  END IF;
  LOCK TABLE platform_admins IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = p_user) THEN
    RAISE EXCEPTION 'That person is not a platform admin' USING ERRCODE = 'P0002', DETAIL = 'vantage:not_admin';
  END IF;
  IF EXISTS (SELECT 1 FROM platform_admins WHERE user_id = p_user AND is_owner) THEN
    RAISE EXCEPTION 'The platform owner can only hand the role over, not be removed'
      USING ERRCODE = '42501', DETAIL = 'vantage:owner_protected';
  END IF;
  IF p_user <> actor AND NOT is_platform_owner() THEN
    RAISE EXCEPTION 'Only the platform owner can remove other platform admins' USING ERRCODE = '42501', DETAIL = 'vantage:owner_only';
  END IF;
  SELECT email INTO target_email FROM users WHERE id = p_user;
  INSERT INTO admin_actions(actor_user_id, action, target_user_id, payload)
    VALUES (actor, 'platform_admin.removed', p_user,
            jsonb_build_object('email', target_email, 'self', p_user = actor));
  DELETE FROM platform_admins WHERE user_id = p_user;
  IF p_user <> actor THEN
    INSERT INTO notifications(user_id, org_id, type, payload)
    VALUES (p_user, NULL, 'platform_admin_removed', jsonb_build_object(
      'title', 'Your Platform admin access ended',
      'body', 'The platform owner removed it. Your teams and account are unchanged.',
      'href', '/'));
  END IF;
END $$;

-- Handing over: only the owner, and the new person becomes the owner.
CREATE OR REPLACE FUNCTION platform_admin_transfer(p_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  target uuid;
BEGIN
  IF actor IS NULL OR NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = '42501', DETAIL = 'vantage:not_platform_admin';
  END IF;
  IF NOT is_platform_owner() THEN
    RAISE EXCEPTION 'Only the platform owner can hand the role over' USING ERRCODE = '42501', DETAIL = 'vantage:owner_only';
  END IF;
  LOCK TABLE platform_admins IN SHARE ROW EXCLUSIVE MODE;
  target := platform_admin_target(p_email);
  IF target = actor THEN
    RAISE EXCEPTION 'Choose someone other than yourself' USING ERRCODE = '22023', DETAIL = 'vantage:self';
  END IF;
  INSERT INTO admin_actions(actor_user_id, action, target_user_id, payload)
    VALUES (actor, 'platform_admin.transferred', target,
            jsonb_build_object('email', lower(btrim(p_email)), 'from', actor));
  DELETE FROM platform_admins WHERE user_id = actor;
  INSERT INTO platform_admins(user_id, granted_by, is_owner) VALUES (target, actor, true)
    ON CONFLICT (user_id) DO UPDATE SET is_owner = true;
  PERFORM platform_admin_welcome(target, actor, true);
  RETURN target;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Team bans
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_bans (
  team_number integer PRIMARY KEY CHECK (team_number BETWEEN 1 AND 99999),
  reason text NOT NULL CHECK (reason IN ('terms', 'privacy', 'terms_and_privacy', 'other')),
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  banned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  banned_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE team_bans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_bans_platform_read ON team_bans;
CREATE POLICY team_bans_platform_read ON team_bans FOR SELECT TO vantage_app USING (is_platform_admin());
GRANT SELECT ON team_bans TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_bans TO vantage_worker;

CREATE OR REPLACE FUNCTION team_is_banned(p_team_number integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM team_bans WHERE team_number = p_team_number)
$$;
REVOKE ALL ON FUNCTION team_is_banned(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION team_is_banned(integer) TO vantage_app, vantage_worker;

CREATE OR REPLACE FUNCTION org_is_banned(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_bans b JOIN organizations o ON o.team_number = b.team_number WHERE o.id = p_org)
$$;
REVOKE ALL ON FUNCTION org_is_banned(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION org_is_banned(uuid) TO vantage_app, vantage_worker;

-- A banned team's members stop being members as far as every row policy is concerned. With no
-- bans the extra check reads an empty table.
CREATE OR REPLACE FUNCTION is_org_member(candidate_org_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT account_age_eligible(current_app_user_id()) AND EXISTS(
    SELECT 1 FROM memberships WHERE org_id=candidate_org_id AND user_id=current_app_user_id())
    AND NOT org_is_banned(candidate_org_id)
$$;

CREATE OR REPLACE FUNCTION has_org_role(candidate_org_id uuid, allowed org_role[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT account_age_eligible(current_app_user_id()) AND EXISTS(
    SELECT 1 FROM memberships WHERE org_id=candidate_org_id AND user_id=current_app_user_id() AND role=ANY(allowed))
    AND NOT org_is_banned(candidate_org_id)
$$;

-- The teams this person belongs to that are locked by a ban, for the screen that says so.
CREATE OR REPLACE FUNCTION my_banned_teams()
RETURNS TABLE (team_number integer, org_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.team_number, o.name
    FROM memberships m
    JOIN organizations o ON o.id = m.org_id
    JOIN team_bans b ON b.team_number = o.team_number
   WHERE m.user_id = current_app_user_id()
   ORDER BY o.team_number
$$;
REVOKE ALL ON FUNCTION my_banned_teams() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_banned_teams() TO vantage_app;

-- Nobody joins, and nobody creates, a banned team, whichever path they take (invite, join code,
-- approval, /claim, the admin console).
CREATE OR REPLACE FUNCTION refuse_banned_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF org_is_banned(NEW.org_id) THEN
    RAISE EXCEPTION 'This team can''t be joined: it was banned for breaking Vantage''s Terms or Privacy Policy'
      USING ERRCODE = '42501', DETAIL = 'vantage:team_banned';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS memberships_refuse_banned ON memberships;
CREATE TRIGGER memberships_refuse_banned BEFORE INSERT ON memberships
  FOR EACH ROW EXECUTE FUNCTION refuse_banned_membership();

CREATE OR REPLACE FUNCTION refuse_banned_team_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.team_number IS NOT NULL AND team_is_banned(NEW.team_number) THEN
    RAISE EXCEPTION 'FRC team % is banned from Vantage', NEW.team_number
      USING ERRCODE = '42501', DETAIL = 'vantage:team_banned';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS organizations_refuse_banned ON organizations;
CREATE TRIGGER organizations_refuse_banned BEFORE INSERT OR UPDATE OF team_number ON organizations
  FOR EACH ROW EXECUTE FUNCTION refuse_banned_team_number();

-- Ban or update a ban. The owner only.
CREATE OR REPLACE FUNCTION team_ban_set(p_team_number integer, p_reason text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  trimmed_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF actor IS NULL OR NOT is_platform_owner() THEN
    RAISE EXCEPTION 'Only the platform owner can ban a team' USING ERRCODE = '42501', DETAIL = 'vantage:owner_only';
  END IF;
  IF p_team_number IS NULL OR p_team_number NOT BETWEEN 1 AND 99999 THEN
    RAISE EXCEPTION 'Enter an FRC team number between 1 and 99999' USING ERRCODE = '22023', DETAIL = 'vantage:bad_team_number';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('terms', 'privacy', 'terms_and_privacy', 'other') THEN
    RAISE EXCEPTION 'Choose why the team is banned' USING ERRCODE = '22023', DETAIL = 'vantage:bad_reason';
  END IF;
  IF trimmed_note IS NOT NULL AND char_length(trimmed_note) > 1000 THEN
    RAISE EXCEPTION 'Keep the note to 1000 characters' USING ERRCODE = '22023', DETAIL = 'vantage:note_too_long';
  END IF;
  INSERT INTO team_bans(team_number, reason, note, banned_by)
  VALUES (p_team_number, p_reason, trimmed_note, actor)
  ON CONFLICT (team_number) DO UPDATE SET reason = excluded.reason, note = excluded.note,
    banned_by = excluded.banned_by, banned_at = now();
  -- Open requests for the number are closed: there is nothing left to approve.
  UPDATE team_setup_requests SET status = 'declined', decline_reason = 'This team is banned from Vantage.',
         reviewed_by = actor, reviewed_at = now(), updated_at = now()
   WHERE team_number = p_team_number AND status = 'pending';
  UPDATE workspace_access_requests r SET status = 'declined', reviewed_by = actor, reviewed_at = now(), updated_at = now()
    FROM organizations o
   WHERE o.id = r.org_id AND o.team_number = p_team_number AND r.status = 'pending';
  INSERT INTO admin_actions(actor_user_id, action, target_org_id, payload)
  SELECT actor, 'team.banned', (SELECT id FROM organizations WHERE team_number = p_team_number ORDER BY created_at LIMIT 1),
         jsonb_build_object('teamNumber', p_team_number, 'reason', p_reason, 'note', trimmed_note);
  -- Members find out why they lost access in their inbox, not from an empty Home.
  INSERT INTO notifications(user_id, org_id, type, payload)
  SELECT m.user_id, NULL, 'team_banned', jsonb_build_object(
    'title', 'Team ' || p_team_number || ' was suspended from Vantage',
    'body', 'Vantage suspended this team for breaking its Terms of Service or Privacy Policy. Your account is unaffected.',
    'href', '/legal/terms')
    FROM memberships m JOIN organizations o ON o.id = m.org_id
   WHERE o.team_number = p_team_number;
END $$;
REVOKE ALL ON FUNCTION team_ban_set(integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION team_ban_set(integer, text, text) TO vantage_app;

CREATE OR REPLACE FUNCTION team_ban_lift(p_team_number integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
BEGIN
  IF actor IS NULL OR NOT is_platform_owner() THEN
    RAISE EXCEPTION 'Only the platform owner can lift a ban' USING ERRCODE = '42501', DETAIL = 'vantage:owner_only';
  END IF;
  DELETE FROM team_bans WHERE team_number = p_team_number;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team % is not banned', p_team_number USING ERRCODE = 'P0002', DETAIL = 'vantage:not_banned';
  END IF;
  INSERT INTO admin_actions(actor_user_id, action, target_org_id, payload)
  SELECT actor, 'team.unbanned', (SELECT id FROM organizations WHERE team_number = p_team_number ORDER BY created_at LIMIT 1),
         jsonb_build_object('teamNumber', p_team_number);
  INSERT INTO notifications(user_id, org_id, type, payload)
  SELECT m.user_id, o.id, 'team_unbanned', jsonb_build_object(
    'title', 'Team ' || p_team_number || ' is back on Vantage',
    'body', 'The suspension was lifted. Everything your team saved is where you left it.',
    'href', '/dashboard?orgId=' || o.id::text)
    FROM memberships m JOIN organizations o ON o.id = m.org_id
   WHERE o.team_number = p_team_number;
END $$;
REVOKE ALL ON FUNCTION team_ban_lift(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION team_ban_lift(integer) TO vantage_app;

-- ---------------------------------------------------------------------------------------------
-- 3. Team requests
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_setup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_number integer NOT NULL CHECK (team_number BETWEEN 1 AND 99999),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Set when the team already exists but nobody leads it, or once an approval created it.
  org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  team_name text CHECK (team_name IS NULL OR char_length(team_name) BETWEEN 2 AND 80),
  requested_team_role text CHECK (requested_team_role IS NULL OR requested_team_role IN ('student','mentor','coach','parent','other')),
  primary_focus text NOT NULL CHECK (primary_focus IN ('competition','build','business','leadership')),
  crew_role text CHECK (crew_role IS NULL OR crew_role IN ('scout','driver','operator','mechanical','electrical','programming','cad','pit','business','other')),
  role_description text CHECK (role_description IS NULL OR char_length(role_description) <= 280),
  -- forwarded: someone else's request for the same team was approved first, so this person's
  -- request went to that team's new owner instead.
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','withdrawn','forwarded')),
  decline_reason text CHECK (decline_reason IS NULL OR char_length(decline_reason) <= 500),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_number, user_id)
);
CREATE INDEX IF NOT EXISTS team_setup_requests_status_idx ON team_setup_requests (status, created_at);
CREATE INDEX IF NOT EXISTS team_setup_requests_user_idx ON team_setup_requests (user_id, updated_at DESC);

ALTER TABLE team_setup_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_setup_requests_own_read ON team_setup_requests;
CREATE POLICY team_setup_requests_own_read ON team_setup_requests FOR SELECT TO vantage_app
  USING (user_id = current_app_user_id() OR is_platform_admin());
GRANT SELECT ON team_setup_requests TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_setup_requests TO vantage_worker;

-- The platform admins hear about a request once a day at most, however often it is re-sent.
CREATE OR REPLACE FUNCTION notify_platform_admins_of_team_request(p_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  req team_setup_requests%ROWTYPE;
  requester text;
BEGIN
  SELECT * INTO req FROM team_setup_requests WHERE id = p_request;
  IF req.id IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM notifications n
              WHERE n.type = 'team_setup_request' AND n.payload->>'requestId' = p_request::text
                AND n.created_at > now() - interval '1 day') THEN
    RETURN;
  END IF;
  SELECT COALESCE(NULLIF(btrim(name), ''), email) INTO requester FROM users WHERE id = req.user_id;
  INSERT INTO notifications(user_id, org_id, type, payload)
  SELECT pa.user_id, NULL, 'team_setup_request', jsonb_build_object(
    'requestId', p_request,
    'teamNumber', req.team_number,
    'requesterName', COALESCE(requester, 'Someone'),
    'title', 'Team ' || req.team_number || ' wants to join Vantage',
    'body', COALESCE(requester, 'Someone') || CASE WHEN req.org_id IS NULL
      THEN ' asked to set up Team ' || req.team_number || '.'
      ELSE ' asked to lead Team ' || req.team_number || ', which nobody leads yet.' END,
    'href', '/admin/teams#team-requests')
    FROM platform_admins pa;
END $$;
REVOKE ALL ON FUNCTION notify_platform_admins_of_team_request(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION request_team_setup(
  p_team_number integer,
  p_team_role text,
  p_primary_focus text,
  p_crew_role text DEFAULT NULL,
  p_role_description text DEFAULT NULL,
  p_team_name text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  existing_org uuid;
  request_id uuid;
  trimmed_description text := NULLIF(btrim(COALESCE(p_role_description, '')), '');
  trimmed_name text := NULLIF(btrim(regexp_replace(COALESCE(p_team_name, ''), '\s+', ' ', 'g')), '');
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = actor AND email_verified = true) THEN
    RAISE EXCEPTION 'Verify your email before requesting a team';
  END IF;
  IF p_team_number IS NULL OR p_team_number NOT BETWEEN 1 AND 99999 THEN
    RAISE EXCEPTION 'Invalid FRC team number';
  END IF;
  IF p_team_role IS NOT NULL AND p_team_role NOT IN ('student','mentor','coach','parent','other') THEN
    RAISE EXCEPTION 'Invalid team role';
  END IF;
  IF p_primary_focus IS NULL OR p_primary_focus NOT IN ('competition','build','business','leadership') THEN
    RAISE EXCEPTION 'Invalid primary focus';
  END IF;
  IF p_crew_role IS NOT NULL AND p_crew_role NOT IN (
    'scout','driver','operator','mechanical','electrical','programming','cad','pit','business','other'
  ) THEN
    RAISE EXCEPTION 'Invalid crew role';
  END IF;
  IF trimmed_description IS NOT NULL AND char_length(trimmed_description) > 280 THEN
    RAISE EXCEPTION 'Role description must be 280 characters or fewer';
  END IF;
  IF trimmed_name IS NOT NULL AND char_length(trimmed_name) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Keep the team name between 2 and 80 characters';
  END IF;
  IF team_is_banned(p_team_number) THEN
    RAISE EXCEPTION 'Team % can''t join Vantage', p_team_number USING ERRCODE = '42501', DETAIL = 'vantage:team_banned';
  END IF;

  SELECT id INTO existing_org FROM organizations WHERE team_number = p_team_number ORDER BY created_at LIMIT 1;
  IF existing_org IS NOT NULL AND EXISTS (
    SELECT 1 FROM memberships WHERE org_id = existing_org AND role = ANY(ARRAY['owner','admin']::org_role[])
  ) THEN
    -- A team with leads decides for itself: request_workspace_access is the way in.
    RAISE EXCEPTION 'Team % is on Vantage already. Ask its owners to let you in.', p_team_number
      USING ERRCODE = '23505', DETAIL = 'vantage:team_exists';
  END IF;
  IF existing_org IS NOT NULL AND EXISTS (SELECT 1 FROM memberships WHERE org_id = existing_org AND user_id = actor) THEN
    RETURN NULL;
  END IF;

  INSERT INTO team_setup_requests(
    team_number, user_id, org_id, team_name, requested_team_role, primary_focus, crew_role, role_description, status
  )
  VALUES (
    p_team_number, actor, existing_org, trimmed_name, p_team_role, p_primary_focus, p_crew_role, trimmed_description, 'pending'
  )
  ON CONFLICT (team_number, user_id) DO UPDATE SET
    org_id = excluded.org_id,
    team_name = COALESCE(excluded.team_name, team_setup_requests.team_name),
    requested_team_role = excluded.requested_team_role,
    primary_focus = excluded.primary_focus,
    crew_role = excluded.crew_role,
    role_description = excluded.role_description,
    status = 'pending', decline_reason = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
  RETURNING id INTO request_id;

  PERFORM notify_platform_admins_of_team_request(request_id);
  RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION request_team_setup(integer, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_team_setup(integer, text, text, text, text, text) TO vantage_app;

-- Take back your own open request (changing the team number, signing up without a team).
CREATE OR REPLACE FUNCTION withdraw_team_setup_request(p_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE team_setup_requests SET status = 'withdrawn', updated_at = now()
   WHERE id = p_request AND user_id = current_app_user_id() AND status = 'pending';
END $$;
REVOKE ALL ON FUNCTION withdraw_team_setup_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION withdraw_team_setup_request(uuid) TO vantage_app;

-- A platform admin's decision. Approving a request for a team that does not exist yet needs the
-- team first (the route creates it as the platform admin with the requester as owner, then passes
-- its id). Approving a request for a team nobody leads makes the requester its owner here.
CREATE OR REPLACE FUNCTION review_team_setup_request(
  p_request uuid,
  p_decision text,
  p_org uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  req team_setup_requests%ROWTYPE;
  target_org uuid;
  trimmed_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF actor IS NULL OR NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = '42501', DETAIL = 'vantage:not_platform_admin';
  END IF;
  SELECT * INTO req FROM team_setup_requests WHERE id = p_request FOR UPDATE;
  IF req.id IS NULL THEN
    RAISE EXCEPTION 'That request is gone' USING ERRCODE = 'P0002', DETAIL = 'vantage:request_missing';
  END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'That request was already handled' USING ERRCODE = '55000', DETAIL = 'vantage:request_closed';
  END IF;
  IF trimmed_reason IS NOT NULL AND char_length(trimmed_reason) > 500 THEN
    RAISE EXCEPTION 'Keep the reason to 500 characters' USING ERRCODE = '22023', DETAIL = 'vantage:reason_too_long';
  END IF;

  IF p_decision = 'decline' THEN
    UPDATE team_setup_requests SET status = 'declined', decline_reason = trimmed_reason,
           reviewed_by = actor, reviewed_at = now(), updated_at = now()
     WHERE id = p_request;
    IF req.org_id IS NOT NULL THEN
      UPDATE workspace_access_requests SET status = 'declined', reviewed_by = actor, reviewed_at = now(), updated_at = now()
       WHERE org_id = req.org_id AND user_id = req.user_id AND status = 'pending';
    END IF;
    INSERT INTO notifications(user_id, org_id, type, payload)
    VALUES (req.user_id, NULL, 'team_setup_declined', jsonb_build_object(
      'requestId', p_request, 'teamNumber', req.team_number,
      'title', 'Your request for Team ' || req.team_number || ' wasn''t approved',
      'body', COALESCE(trimmed_reason, 'Check the team number, or ask your team''s mentor to request it.'),
      'href', '/onboarding?state=pending'));
    RETURN;
  END IF;

  IF p_decision <> 'approve' THEN
    RAISE EXCEPTION 'Choose approve or decline' USING ERRCODE = '22023', DETAIL = 'vantage:bad_decision';
  END IF;
  IF team_is_banned(req.team_number) THEN
    RAISE EXCEPTION 'Team % is banned. Lift the ban first.', req.team_number USING ERRCODE = '42501', DETAIL = 'vantage:team_banned';
  END IF;

  target_org := COALESCE(p_org, req.org_id);
  IF target_org IS NULL THEN
    RAISE EXCEPTION 'Create the team before approving' USING ERRCODE = '22023', DETAIL = 'vantage:org_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = target_org AND team_number = req.team_number) THEN
    RAISE EXCEPTION 'That team does not match the request' USING ERRCODE = '22023', DETAIL = 'vantage:org_mismatch';
  END IF;

  INSERT INTO memberships(org_id, user_id, role) VALUES (target_org, req.user_id, 'owner')
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner';
  UPDATE workspace_access_requests SET status = 'approved', membership_role = 'owner',
         reviewed_by = actor, reviewed_at = now(), updated_at = now()
   WHERE org_id = target_org AND user_id = req.user_id AND status = 'pending';
  UPDATE team_setup_requests SET status = 'approved', org_id = target_org,
         reviewed_by = actor, reviewed_at = now(), updated_at = now()
   WHERE id = p_request;

  -- Everyone else who asked for this team now asks its new owner.
  INSERT INTO workspace_access_requests(org_id, user_id, requested_team_role, primary_focus, crew_role, role_description, status)
  SELECT target_org, r.user_id, r.requested_team_role, r.primary_focus, r.crew_role, r.role_description, 'pending'
    FROM team_setup_requests r
   WHERE r.team_number = req.team_number AND r.status = 'pending' AND r.id <> p_request
  ON CONFLICT (org_id, user_id) DO UPDATE SET status = 'pending', updated_at = now();
  INSERT INTO notifications(user_id, org_id, type, payload)
  SELECT r.user_id, NULL, 'team_setup_forwarded', jsonb_build_object(
    'teamNumber', r.team_number,
    'title', 'Team ' || r.team_number || ' is on Vantage now',
    'body', 'Your request went to the team''s owner, who decides who joins.',
    'href', '/onboarding?state=pending')
    FROM team_setup_requests r
   WHERE r.team_number = req.team_number AND r.status = 'pending' AND r.id <> p_request;
  UPDATE team_setup_requests SET status = 'forwarded', org_id = target_org, updated_at = now()
   WHERE team_number = req.team_number AND status = 'pending' AND id <> p_request;

  INSERT INTO notifications(user_id, org_id, type, payload)
  VALUES (req.user_id, target_org, 'team_setup_approved', jsonb_build_object(
    'requestId', p_request, 'teamNumber', req.team_number,
    'title', 'Team ' || req.team_number || ' is ready',
    'body', 'You''re its owner. Invite your teammates from Team admin.',
    'href', '/dashboard?orgId=' || target_org::text));
  INSERT INTO admin_actions(actor_user_id, action, target_org_id, target_user_id, payload)
  VALUES (actor, 'team_request.approved', target_org, req.user_id, jsonb_build_object('teamNumber', req.team_number, 'requestId', p_request));
END $$;
REVOKE ALL ON FUNCTION review_team_setup_request(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION review_team_setup_request(uuid, text, uuid, text) TO vantage_app;

-- Team requests with the requester's name and email, for the admin console.
CREATE OR REPLACE FUNCTION team_setup_request_list()
RETURNS TABLE (
  id uuid, team_number integer, team_name text, status text, org_id uuid,
  requester_id uuid, requester_name text, requester_email text,
  requested_team_role text, crew_role text, role_description text, decline_reason text,
  created_at timestamptz, updated_at timestamptz, reviewed_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = '42501', DETAIL = 'vantage:not_platform_admin';
  END IF;
  RETURN QUERY
    SELECT r.id, r.team_number, r.team_name, r.status, r.org_id,
           r.user_id, COALESCE(NULLIF(btrim(pr.display_name), ''), NULLIF(btrim(u.name), ''), u.email), u.email,
           r.requested_team_role, r.crew_role, r.role_description, r.decline_reason,
           r.created_at, r.updated_at, r.reviewed_at
      FROM team_setup_requests r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN profiles pr ON pr.user_id = r.user_id
     ORDER BY (r.status = 'pending') DESC, r.updated_at DESC
     LIMIT 300;
END $$;
REVOKE ALL ON FUNCTION team_setup_request_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION team_setup_request_list() TO vantage_app;

-- Asking to join a team now refuses a banned number, and a team nobody leads yet (its owner was
-- invited but never joined, or left) sends the request to the platform admins too: before, it
-- notified nobody and waited forever.
CREATE OR REPLACE FUNCTION request_workspace_access(
  candidate_team_number integer,
  candidate_team_role text,
  candidate_primary_focus text,
  candidate_crew_role text DEFAULT NULL,
  candidate_role_description text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  candidate_org_id uuid;
  request_id uuid;
  trimmed_description text;
  requester_name text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=actor AND email_verified=true) THEN
    RAISE EXCEPTION 'Verify your email before requesting team access';
  END IF;
  IF candidate_team_number NOT BETWEEN 1 AND 99999 THEN RAISE EXCEPTION 'Invalid FRC team number'; END IF;
  IF candidate_team_role IS NOT NULL AND candidate_team_role NOT IN ('student','mentor','coach','parent','other') THEN
    RAISE EXCEPTION 'Invalid team role';
  END IF;
  IF candidate_primary_focus NOT IN ('competition','build','business','leadership') THEN
    RAISE EXCEPTION 'Invalid primary focus';
  END IF;
  IF candidate_crew_role IS NOT NULL AND candidate_crew_role NOT IN (
    'scout','driver','operator','mechanical','electrical','programming','cad','pit','business','other'
  ) THEN
    RAISE EXCEPTION 'Invalid crew role';
  END IF;
  trimmed_description := NULLIF(btrim(COALESCE(candidate_role_description, '')), '');
  IF trimmed_description IS NOT NULL AND char_length(trimmed_description) > 280 THEN
    RAISE EXCEPTION 'Role description must be 280 characters or fewer';
  END IF;
  IF team_is_banned(candidate_team_number) THEN
    RAISE EXCEPTION 'Team % can''t join Vantage', candidate_team_number USING ERRCODE = '42501', DETAIL = 'vantage:team_banned';
  END IF;

  SELECT id INTO candidate_org_id FROM organizations
   WHERE team_number = candidate_team_number ORDER BY created_at ASC LIMIT 1;
  IF candidate_org_id IS NULL THEN
    RAISE EXCEPTION 'No Vantage workspace exists for FRC team % yet. Ask a team leader to create it first.', candidate_team_number;
  END IF;
  IF EXISTS (SELECT 1 FROM memberships WHERE org_id=candidate_org_id AND user_id=actor) THEN
    RETURN NULL;
  END IF;

  INSERT INTO workspace_access_requests(
    org_id,user_id,requested_team_role,primary_focus,crew_role,role_description,status
  )
  VALUES(
    candidate_org_id,actor,candidate_team_role,candidate_primary_focus,
    candidate_crew_role,trimmed_description,'pending'
  )
  ON CONFLICT (org_id,user_id) DO UPDATE SET
    requested_team_role=excluded.requested_team_role,
    primary_focus=excluded.primary_focus,
    crew_role=excluded.crew_role,
    role_description=excluded.role_description,
    status='pending', membership_role=NULL, reviewed_by=NULL, reviewed_at=NULL, updated_at=now()
  RETURNING id INTO request_id;

  IF NOT EXISTS (
    SELECT 1 FROM memberships WHERE org_id = candidate_org_id AND role = ANY(ARRAY['owner','admin']::org_role[])
  ) THEN
    PERFORM request_team_setup(candidate_team_number, candidate_team_role, candidate_primary_focus,
                               candidate_crew_role, trimmed_description, NULL);
    RETURN request_id;
  END IF;

  -- Leads hear about a request once a day at most: re-saving onboarding, or asking again
  -- straight after a decline, used to notify every owner and admin each time.
  IF EXISTS (SELECT 1 FROM notifications n
              WHERE n.org_id = candidate_org_id AND n.type = 'team_access_request'
                AND n.payload->>'requestId' = request_id::text
                AND n.created_at > now() - interval '1 day') THEN
    RETURN request_id;
  END IF;
  SELECT COALESCE(NULLIF(btrim(name), ''), email) INTO requester_name FROM users WHERE id=actor;
  INSERT INTO notifications (user_id, org_id, type, payload)
  SELECT m.user_id, candidate_org_id, 'team_access_request',
         jsonb_build_object(
           'requestId', request_id,
           'orgId', candidate_org_id,
           'requesterName', COALESCE(requester_name, 'A new member'),
           'teamNumber', o.team_number,
           'href', '/team/admin?orgId=' || candidate_org_id::text || '#team-access-title'
         )
  FROM memberships m
  JOIN organizations o ON o.id = m.org_id
  WHERE m.org_id = candidate_org_id
    AND m.role = ANY(ARRAY['owner','admin']::org_role[]);

  RETURN request_id;
END $$;

-- ---------------------------------------------------------------- View only (0715)

-- A person's own request to join Vantage, written only through request_team_setup: not team data.
INSERT INTO view_only_exempt_tables (table_name, reason, added_in) VALUES
  ('team_setup_requests', 'Own request to put a team on Vantage, written only by request_team_setup and platform admins.', '0733')
ON CONFLICT (table_name) DO UPDATE SET reason = EXCLUDED.reason;

SELECT install_view_only_guards();
