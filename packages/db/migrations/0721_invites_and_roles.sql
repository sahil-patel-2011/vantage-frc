-- Getting people onto a team, and what each role can do (QA report 3).
--
-- Eight changes, one batch. Each says what was wrong and what is true now.
--
-- 1. INVITES ARE READ BY THE PEOPLE WHO MANAGE THEM (A3-03)
--    invites_member_read (0001) let any member, a View only parent included, read every
--    invite row through /api/organizations/invites: the email of every invited and accepted
--    member and every pending invitee. The roster deliberately shows names only. Reading is
--    now limited to whoever may manage people (owners, admins, and holders of the delegated
--    manage_members capability); platform admins keep invites_platform_read (0479).
--
-- 2. THE TEAM JOIN CODE STARTS OFF, AND A CODE JOINER STARTS AS PARENT OR GUEST (A3-01, A3-02)
--    Every new team got an enabled code, hidden in a collapsed panel, and anyone with the team
--    number and six digits joined as a scout (write access to tasks, chat, scouting) without
--    an owner deciding anything. The model now:
--      * a new code is off until an owner or admin turns it on (column default false; the app
--        creates codes with enabled=false and only an explicit "Turn on" enables one);
--      * the code carries the access it gives (join_role): 'viewer' (Parent or guest: can look,
--        can't change) unless the owner chose 'scout' (Student). Existing codes get 'viewer',
--        so a code already on a poster or in a group chat no longer hands out write access;
--      * whatever the code gives, a joiner who said in onboarding that they are a parent gets
--        Parent or guest, and a code never makes anyone a mentor or coach;
--      * owners and admins are told who joined, with what access, and what the person said
--        they are, so promoting a student is one tap (app side).
--
-- 3. JOIN-CODE LOCKOUT IS PER PERSON, AND THE APP CAN SAY "TRY AGAIN AT 8:42 PM" (A3-14)
--    Five wrong tries locked the whole network for that team for 15 minutes, the right code
--    included, and the page said "wait fifteen minutes" on the first mistake. Now five wrong
--    tries lock that network + team + email address, and twenty wrong tries from one network
--    (any addresses) lock the network for that team, which still bounds guessing. A lockout
--    is checked before the code, so it reveals nothing about the code. The new
--    team_code_join_retry_at() tells the app when a refused person may try again.
--
-- 4. ACCEPTING AN INVITE NEVER CLAIMS A JOIN THAT DID NOT HAPPEN (A3-12)
--    accept_org_invite (0005) and accept_my_org_invite (0686) inserted the membership with
--    ON CONFLICT DO NOTHING, so a member opening an older invite for more access stayed
--    where they were while the invite was marked used and the owner was told they "joined".
--    An email invite now raises an existing member to the invited access (never lowers it);
--    a team-code invite never changes an existing membership. Both share
--    apply_accepted_invite(). my_invite_join_context() lets the joiner's request word the
--    owner's notice correctly (joined or not, by code or not, what they said they are).
--
-- 5. A REPLACED INVITE LINK SAYS SO (A3-09)
--    "Resend" and "Get a new link" rotate the token, and the earlier email's link then read
--    "This invite link doesn't work. The link may be cut off." The old token hash is now kept
--    (invite_replaced_tokens, written by a trigger on every rotation, including the platform
--    admin's owner-invite reissue), and peek_replaced_invite() names the team and says a
--    newer link was sent.
--
-- 6. ROLE CHANGES, REMOVALS AND HANDOVERS REACH THE PERSON (A3-15, A3-16)
--    Peer-insert policies for the three notices an owner or admin writes for someone else:
--    team_role_changed and team_ownership_given (org-scoped, to a current member), and
--    team_removed (org_id NULL, because the person is no longer a member and must still see
--    it; only right after the inserting lead's own member.removed audit row for that person).
--
-- 7. A STUDENT CAN ASK THE OWNER TO INVITE A MENTOR (A3-04)
--    suggest_team_invite() lets any member send their owners and admins one
--    'invite_suggestion' notice with the address and the access they suggest. It writes
--    notifications only (no membership, no invite), five per person per hour.
--
-- 8. ASKING-TO-JOIN: MENTORS CAN BE APPROVED, THE NOTICE LINKS TO TEAM ADMIN, NO SPAM (A3-17)
--    review_workspace_access() accepted only scout or viewer; an owner may now approve a
--    mentor as admin. request_workspace_access() linked leads to /team (the inbox is on
--    /team/admin) and re-notified every lead on every re-submit; it now links to Team admin
--    and notifies at most once a day per request.
--
-- 9. THE VIEW ONLY SENTENCE USES THE ROLE WORDS (A3-06)
--    refuse_view_only_write() (0715) asked for "Team member access", a name no screen uses
--    any more. Same function, same code and detail, the sentence the app now uses.
--
-- Safe to re-run: CREATE OR REPLACE functions, IF NOT EXISTS, and policies dropped first.

-- ---------------------------------------------------------------- 1. invites read
DROP POLICY IF EXISTS invites_member_read ON invites;
DROP POLICY IF EXISTS invites_manager_read ON invites;
CREATE POLICY invites_manager_read ON invites FOR SELECT TO vantage_app
  USING (has_org_capability(org_id, 'manage_members'::org_capability));

-- ---------------------------------------------------------------- 2. join code defaults
ALTER TABLE team_join_codes ALTER COLUMN enabled SET DEFAULT false;
ALTER TABLE team_join_codes ADD COLUMN IF NOT EXISTS join_role org_role NOT NULL DEFAULT 'viewer';
ALTER TABLE team_join_codes DROP CONSTRAINT IF EXISTS team_join_codes_join_role_check;
ALTER TABLE team_join_codes ADD CONSTRAINT team_join_codes_join_role_check
  CHECK (join_role IN ('scout'::org_role, 'viewer'::org_role));
COMMENT ON COLUMN team_join_codes.join_role IS
  'Access a code joiner gets: viewer (Parent or guest, the default) or scout (Student). Parents always get viewer (0721).';

-- ---------------------------------------------------------------- 3. code requests and lockout
CREATE OR REPLACE FUNCTION request_team_code_invite(team integer, pin text, address text, ip_bucket text, raw_token text)
RETURNS uuid LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path=public AS $$
DECLARE
  target team_join_codes%ROWTYPE;
  inviter uuid;
  invitation uuid;
  count_used integer;
  attempt_key text;
  address_key text;
BEGIN
  IF team < 1 OR team > 99999 OR pin !~ '^[0-9]{6}$'
    OR length(address)>254 OR address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR length(ip_bucket)>128 OR raw_token !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN NULL; END IF;
  address_key := encode(digest(lower(address),'sha256'),'hex');
  -- Commit denied attempts by returning, not raising (which rolls back counters).
  DELETE FROM team_join_attempts WHERE reset_at < now();
  FOREACH attempt_key IN ARRAY ARRAY['network:'||ip_bucket, 'address:'||address_key] LOOP
    INSERT INTO team_join_attempts(bucket,attempts,reset_at) VALUES(attempt_key,1,now()+interval '15 minutes')
      ON CONFLICT(bucket) DO UPDATE SET attempts=team_join_attempts.attempts+1
      RETURNING attempts INTO count_used;
    IF count_used > (CASE WHEN attempt_key LIKE 'network:%' THEN 120 ELSE 8 END) THEN RETURN NULL; END IF;
  END LOOP;
  -- Locked out: refused before the code is looked at, so the right code during a lockout is
  -- answered exactly like a wrong one. One person's typos lock only that person (network +
  -- team + address); many wrong tries from one network lock that network for the team.
  IF EXISTS(SELECT 1 FROM team_join_attempts
             WHERE (bucket='wrong:'||ip_bucket||':'||team||':'||address_key AND attempts>=5)
                OR (bucket='wrong:'||ip_bucket||':'||team AND attempts>=20)) THEN
    RETURN NULL;
  END IF;
  SELECT c.* INTO target FROM team_join_codes c JOIN organizations o ON o.id=c.org_id
    WHERE o.team_number=team FOR UPDATE OF c;
  IF target.org_id IS NULL OR NOT target.enabled OR crypt(pin,target.pin_hash)<>target.pin_hash THEN
    FOREACH attempt_key IN ARRAY ARRAY['wrong:'||ip_bucket||':'||team||':'||address_key, 'wrong:'||ip_bucket||':'||team] LOOP
      INSERT INTO team_join_attempts(bucket,attempts,reset_at) VALUES(attempt_key,1,now()+interval '15 minutes')
        ON CONFLICT(bucket) DO UPDATE SET attempts=team_join_attempts.attempts+1;
    END LOOP;
    RETURN NULL;
  END IF;
  SELECT m.user_id INTO inviter FROM memberships m WHERE m.org_id=target.org_id AND m.role IN ('owner','admin')
    ORDER BY CASE WHEN m.role='owner' THEN 0 ELSE 1 END,m.created_at LIMIT 1;
  IF inviter IS NULL THEN RETURN NULL; END IF;
  -- Reissuing this exact address revokes only its earlier code-based invites.
  UPDATE invites SET status='revoked' WHERE org_id=target.org_id AND lower(email)=lower(address) AND status='pending'
    AND id IN (SELECT invite_id FROM team_join_code_invites WHERE org_id=target.org_id);
  -- The access the owner chose for the code (Parent or guest unless they picked Student).
  INSERT INTO invites(org_id,email,role,token_hash,invited_by,expires_at)
    VALUES(target.org_id,lower(address),COALESCE(target.join_role,'viewer'),encode(digest(raw_token,'sha256'),'hex'),inviter,now()+interval '30 minutes')
    RETURNING id INTO invitation;
  INSERT INTO team_join_code_invites(org_id,invite_id) VALUES(target.org_id,invitation);
  INSERT INTO membership_audit_events(org_id,actor_user_id,action,target_email_hash)
    VALUES(target.org_id,inviter,'team.join_code.requested',address_key);
  RETURN invitation;
END $$;
REVOKE ALL ON FUNCTION request_team_code_invite(integer,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_team_code_invite(integer,text,text,text,text) TO vantage_app;

-- When a refused code request may be tried again, or NULL when nothing is locked (the code was
-- just wrong). Reads only the counters for this network, team and address; changes nothing.
CREATE OR REPLACE FUNCTION team_code_join_retry_at(team integer, address text, ip_bucket text)
RETURNS timestamptz LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=public AS $$
  SELECT max(a.reset_at)
    FROM team_join_attempts a
   WHERE a.reset_at > now()
     AND length(ip_bucket) <= 128 AND length(address) <= 254
     AND (
       (a.bucket = 'network:'||ip_bucket AND a.attempts > 120)
       OR (a.bucket = 'address:'||encode(digest(lower(address),'sha256'),'hex') AND a.attempts > 8)
       OR (a.bucket = 'wrong:'||ip_bucket||':'||team||':'||encode(digest(lower(address),'sha256'),'hex') AND a.attempts >= 5)
       OR (a.bucket = 'wrong:'||ip_bucket||':'||team AND a.attempts >= 20)
     )
$$;
REVOKE ALL ON FUNCTION team_code_join_retry_at(integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION team_code_join_retry_at(integer,text,text) TO vantage_app;

-- ---------------------------------------------------------------- 4. accepting an invite
-- Internal: called only by the two SECURITY DEFINER accept functions below.
CREATE OR REPLACE FUNCTION apply_accepted_invite(accepted_invite uuid, member uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  candidate invites%ROWTYPE;
  via_code boolean;
  granted org_role;
BEGIN
  SELECT * INTO candidate FROM invites WHERE id=accepted_invite;
  IF candidate.id IS NULL THEN RAISE EXCEPTION 'Invite is invalid or already used'; END IF;
  via_code := EXISTS(SELECT 1 FROM team_join_code_invites c WHERE c.invite_id=candidate.id);
  granted := candidate.role;
  -- Nobody chose this person's access when they joined with the team code: someone who says
  -- they are a parent only looks, and a code never makes anyone a mentor or coach.
  IF via_code THEN
    IF granted NOT IN ('scout','viewer') THEN granted := 'viewer'; END IF;
    IF EXISTS(SELECT 1 FROM profiles p WHERE p.user_id=member AND p.team_role='parent') THEN
      granted := 'viewer';
    END IF;
  END IF;
  -- Already on the team: an email invite (an owner's or admin's choice for this address)
  -- raises their access to what it offers and never lowers it; a code changes nothing.
  INSERT INTO memberships(org_id,user_id,role) VALUES(candidate.org_id,member,granted)
    ON CONFLICT(org_id,user_id) DO UPDATE SET role=EXCLUDED.role
    WHERE NOT via_code
      AND (CASE EXCLUDED.role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'scout' THEN 1 ELSE 0 END)
        > (CASE memberships.role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'scout' THEN 1 ELSE 0 END);
  UPDATE invites SET status='accepted',accepted_by=member,accepted_at=now() WHERE id=candidate.id;
END $$;
REVOKE ALL ON FUNCTION apply_accepted_invite(uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION accept_org_invite(raw_token text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  candidate invites%ROWTYPE;
  app_user users%ROWTYPE;
BEGIN
  SELECT * INTO app_user FROM users WHERE id=current_app_user_id();
  IF app_user.id IS NULL OR NOT app_user.email_verified THEN
    RAISE EXCEPTION 'A verified email is required';
  END IF;
  SELECT * INTO candidate FROM invites
    WHERE token_hash=encode(digest(raw_token,'sha256'),'hex')
    FOR UPDATE;
  IF candidate.id IS NULL OR candidate.status <> 'pending' THEN
    RAISE EXCEPTION 'Invite is invalid or already used';
  END IF;
  IF candidate.expires_at <= now() THEN
    UPDATE invites SET status='expired' WHERE id=candidate.id;
    RAISE EXCEPTION 'Invite has expired';
  END IF;
  IF lower(candidate.email) <> lower(app_user.email) THEN
    RAISE EXCEPTION 'Invite email does not match the signed-in account';
  END IF;
  PERFORM apply_accepted_invite(candidate.id, app_user.id);
  RETURN candidate.org_id;
END $$;
REVOKE ALL ON FUNCTION accept_org_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_org_invite(text) TO vantage_app;

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
  PERFORM apply_accepted_invite(candidate.id, app_user.id);
  RETURN candidate.org_id;
END $$;
REVOKE ALL ON FUNCTION accept_my_org_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_my_org_invite(uuid) TO vantage_app;

-- For the joiner's own request, right after accepting: how they came in, so the owners'
-- notice can say "joined with the team code as Parent or guest. They said they're a parent."
-- joined_now is true only when the membership was created in this transaction.
CREATE OR REPLACE FUNCTION my_invite_join_context(target_org uuid)
RETURNS TABLE(via_code boolean, invited_role org_role, member_role org_role, joined_now boolean, self_role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM team_join_code_invites c WHERE c.invite_id=i.id),
         i.role, m.role, m.created_at = now(), p.team_role
    FROM invites i
    JOIN memberships m ON m.org_id=i.org_id AND m.user_id=i.accepted_by
    LEFT JOIN profiles p ON p.user_id=i.accepted_by
   WHERE i.org_id=target_org AND i.accepted_by=current_app_user_id() AND i.status='accepted'
   ORDER BY i.accepted_at DESC NULLS LAST
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION my_invite_join_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_invite_join_context(uuid) TO vantage_app;

-- ---------------------------------------------------------------- 5. replaced invite links
CREATE TABLE IF NOT EXISTS invite_replaced_tokens (
  token_hash text PRIMARY KEY,
  invite_id uuid NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
  replaced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invite_replaced_tokens_invite_idx ON invite_replaced_tokens(invite_id);
ALTER TABLE invite_replaced_tokens ENABLE ROW LEVEL SECURITY;
-- No request-role policies or grants: only the trigger and peek_replaced_invite() use it.
REVOKE ALL ON invite_replaced_tokens FROM PUBLIC;

CREATE OR REPLACE FUNCTION remember_replaced_invite_token() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF OLD.token_hash IS NOT NULL AND OLD.token_hash IS DISTINCT FROM NEW.token_hash THEN
    INSERT INTO invite_replaced_tokens(token_hash,invite_id) VALUES(OLD.token_hash,OLD.id)
      ON CONFLICT(token_hash) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION remember_replaced_invite_token() FROM PUBLIC;
DROP TRIGGER IF EXISTS invites_remember_replaced_token ON invites;
CREATE TRIGGER invites_remember_replaced_token
  AFTER UPDATE OF token_hash ON invites
  FOR EACH ROW EXECUTE FUNCTION remember_replaced_invite_token();

-- An old link: which team, and what became of the invite it belonged to. Nothing else (no
-- email, no new token): the person holding the old link was already sent the team's name.
CREATE OR REPLACE FUNCTION peek_replaced_invite(raw_token text)
RETURNS TABLE(org_name text, team_number integer, status text, replaced_at timestamptz)
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=public AS $$
  SELECT o.name, o.team_number, i.status::text, r.replaced_at
    FROM invite_replaced_tokens r
    JOIN invites i ON i.id=r.invite_id
    JOIN organizations o ON o.id=i.org_id
   WHERE r.token_hash=encode(digest(raw_token,'sha256'),'hex')
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION peek_replaced_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION peek_replaced_invite(text) TO vantage_app;

-- ---------------------------------------------------------------- 6. membership notices
DROP POLICY IF EXISTS notifications_membership_change_peer_insert ON notifications;
CREATE POLICY notifications_membership_change_peer_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type IN ('team_role_changed', 'team_ownership_given')
    AND org_id IS NOT NULL
    AND user_id <> current_app_user_id()
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id AND m.user_id = notifications.user_id
    )
  );

DROP POLICY IF EXISTS notifications_team_removed_peer_insert ON notifications;
CREATE POLICY notifications_team_removed_peer_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'team_removed'
    AND org_id IS NULL
    AND user_id <> current_app_user_id()
    AND has_org_role(
      CASE WHEN payload->>'orgId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN (payload->>'orgId')::uuid END,
      ARRAY['owner','admin']::org_role[])
    AND NOT EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id::text = payload->>'orgId' AND m.user_id = notifications.user_id
    )
    AND EXISTS (
      SELECT 1 FROM membership_audit_events a
      WHERE a.org_id::text = payload->>'orgId'
        AND a.action = 'member.removed'
        AND a.actor_user_id = current_app_user_id()
        AND a.metadata->>'userId' = notifications.user_id::text
        AND a.created_at > now() - interval '10 minutes'
    )
  );

-- ---------------------------------------------------------------- 7. suggest someone to invite
CREATE OR REPLACE FUNCTION suggest_team_invite(target_org uuid, address text, wanted_role text, note text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  actor uuid := current_app_user_id();
  clean_email text := lower(btrim(COALESCE(address,'')));
  clean_note text := NULLIF(btrim(COALESCE(note,'')),'');
  actor_name text;
  suggestion uuid := gen_random_uuid();
  sent integer;
BEGIN
  IF actor IS NULL OR target_org IS NULL OR NOT is_org_member(target_org) THEN
    RAISE EXCEPTION 'You are not a member of this team';
  END IF;
  IF length(clean_email) > 254 OR clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter their full email address, like name@school.org.';
  END IF;
  IF wanted_role IS NULL OR wanted_role NOT IN ('admin','scout','viewer') THEN
    RAISE EXCEPTION 'Choose what they would do on the team.';
  END IF;
  IF clean_note IS NOT NULL AND char_length(clean_note) > 280 THEN
    RAISE EXCEPTION 'Keep the note to 280 characters or fewer.';
  END IF;
  -- Five suggestions an hour per person, so this can never be used to flood the leads.
  IF (SELECT count(DISTINCT n.payload->>'suggestionId') FROM notifications n
       WHERE n.org_id=target_org AND n.type='invite_suggestion'
         AND n.payload->>'fromUserId'=actor::text AND n.created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'You sent five suggestions this hour. Try again later.';
  END IF;
  SELECT COALESCE(NULLIF(btrim(concat_ws(' ',p.first_name,p.last_name)),''), NULLIF(btrim(u.name),''), 'A teammate')
    INTO actor_name
    FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=actor;
  INSERT INTO notifications(user_id,org_id,type,payload)
  SELECT m.user_id, target_org, 'invite_suggestion',
         jsonb_build_object(
           'suggestionId', suggestion,
           'fromUserId', actor,
           'fromName', COALESCE(actor_name,'A teammate'),
           'email', clean_email,
           'suggestedRole', wanted_role,
           'note', clean_note)
    FROM memberships m
   WHERE m.org_id=target_org AND m.role IN ('owner','admin') AND m.user_id <> actor;
  GET DIAGNOSTICS sent = ROW_COUNT;
  INSERT INTO membership_audit_events(org_id,actor_user_id,action,target_email_hash,metadata)
    VALUES(target_org,actor,'invite.suggested',encode(digest(clean_email,'sha256'),'hex'),
           jsonb_build_object('suggestedRole',wanted_role,'notified',sent));
  RETURN sent;
END $$;
REVOKE ALL ON FUNCTION suggest_team_invite(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION suggest_team_invite(uuid,text,text,text) TO vantage_app;

-- ---------------------------------------------------------------- 8. asking to join
CREATE OR REPLACE FUNCTION review_workspace_access(
  candidate_request_id uuid,
  candidate_decision text,
  candidate_role org_role
) RETURNS TABLE(
  request_id uuid, applicant_user_id uuid, applicant_email text, applicant_name text,
  organization_id uuid, organization_name text, decision text, granted_role org_role
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  req workspace_access_requests%ROWTYPE;
BEGIN
  IF candidate_decision NOT IN ('approved','declined') THEN RAISE EXCEPTION 'Invalid review decision'; END IF;
  IF candidate_role NOT IN ('admin','scout','viewer') THEN RAISE EXCEPTION 'Invalid membership role'; END IF;
  SELECT * INTO req FROM workspace_access_requests WHERE id=candidate_request_id FOR UPDATE;
  IF req.id IS NULL OR NOT has_org_role(req.org_id, ARRAY['owner','admin']::org_role[]) THEN
    RAISE EXCEPTION 'Pending access request not found';
  END IF;
  -- Same rule as an invite: only an owner brings in another mentor or coach.
  IF candidate_decision='approved' AND candidate_role='admin'
     AND NOT has_org_role(req.org_id, ARRAY['owner']::org_role[]) THEN
    RAISE EXCEPTION 'Only an owner may approve someone as a mentor or coach';
  END IF;
  IF req.status <> 'pending' THEN RAISE EXCEPTION 'Access request was already reviewed'; END IF;

  IF candidate_decision='approved' THEN
    INSERT INTO memberships(org_id,user_id,role) VALUES(req.org_id,req.user_id,candidate_role)
    ON CONFLICT (org_id,user_id) DO NOTHING;
  END IF;
  UPDATE workspace_access_requests SET status=candidate_decision,
    membership_role=CASE WHEN candidate_decision='approved' THEN candidate_role ELSE NULL END,
    reviewed_by=actor,reviewed_at=now(),updated_at=now() WHERE id=req.id;

  RETURN QUERY SELECT req.id,u.id,u.email,u.name,o.id,o.name,candidate_decision,
    CASE WHEN candidate_decision='approved' THEN candidate_role ELSE NULL::org_role END
    FROM users u JOIN organizations o ON o.id=req.org_id WHERE u.id=req.user_id;
END $$;
REVOKE ALL ON FUNCTION review_workspace_access(uuid,text,org_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION review_workspace_access(uuid,text,org_role) TO vantage_app;

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
REVOKE ALL ON FUNCTION request_workspace_access(integer,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_workspace_access(integer,text,text,text,text) TO vantage_app;

-- ---------------------------------------------------------------- 9. the View only sentence
CREATE OR REPLACE FUNCTION refuse_view_only_write(target_org_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF target_org_id IS NOT NULL AND is_org_viewer(target_org_id) THEN
    RAISE EXCEPTION 'View only — you can look but not change this. Ask the team owner or a mentor or coach for Student access.'
      USING ERRCODE = 'insufficient_privilege', DETAIL = 'vantage:view_only';
  END IF;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION refuse_view_only_write(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refuse_view_only_write(uuid) TO vantage_app, vantage_worker;
