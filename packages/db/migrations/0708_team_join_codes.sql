-- A team-controlled, revocable shortcut into verified-email invitations.
CREATE TABLE team_join_codes (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  encrypted_pin text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE team_join_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_join_codes_managers ON team_join_codes FOR ALL TO vantage_app
  USING(has_org_capability(org_id,'manage_members'))
  WITH CHECK(has_org_capability(org_id,'manage_members'));
GRANT SELECT,INSERT,UPDATE ON team_join_codes TO vantage_app;

CREATE TABLE team_join_code_invites (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invite_id uuid PRIMARY KEY REFERENCES invites(id) ON DELETE CASCADE
);
ALTER TABLE team_join_code_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_join_code_invites_managers ON team_join_code_invites FOR ALL TO vantage_app
  USING(has_org_capability(org_id,'manage_members'))
  WITH CHECK(has_org_capability(org_id,'manage_members'));
GRANT SELECT,INSERT,DELETE ON team_join_code_invites TO vantage_app;

CREATE TABLE team_join_attempts (
  bucket text PRIMARY KEY,
  attempts integer NOT NULL,
  reset_at timestamptz NOT NULL
);
ALTER TABLE team_join_attempts ENABLE ROW LEVEL SECURITY;
-- No direct request-role access. The narrow function below owns all attempts.
CREATE FUNCTION request_team_code_invite(team integer, pin text, address text, ip_bucket text, raw_token text)
RETURNS uuid LANGUAGE plpgsql STRICT SECURITY DEFINER SET search_path=public AS $$
DECLARE
  target team_join_codes%ROWTYPE;
  inviter uuid;
  invitation uuid;
  count_used integer;
  attempt_key text;
BEGIN
  IF team < 1 OR team > 99999 OR pin !~ '^[0-9]{6}$'
    OR length(address)>254 OR address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR length(ip_bucket)>128 OR raw_token !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN NULL; END IF;
  -- Commit denied attempts by returning, not raising (which rolls back counters).
  DELETE FROM team_join_attempts WHERE reset_at < now();
  FOREACH attempt_key IN ARRAY ARRAY['network:'||ip_bucket, 'address:'||encode(digest(lower(address),'sha256'),'hex')] LOOP
    INSERT INTO team_join_attempts(bucket,attempts,reset_at) VALUES(attempt_key,1,now()+interval '15 minutes')
      ON CONFLICT(bucket) DO UPDATE SET attempts=team_join_attempts.attempts+1
      RETURNING attempts INTO count_used;
    IF count_used > (CASE WHEN attempt_key LIKE 'network:%' THEN 120 ELSE 8 END) THEN RETURN NULL; END IF;
  END LOOP;
  SELECT c.* INTO target FROM team_join_codes c JOIN organizations o ON o.id=c.org_id
    WHERE o.team_number=team FOR UPDATE OF c;
  IF target.org_id IS NULL OR NOT target.enabled OR crypt(pin,target.pin_hash)<>target.pin_hash THEN
    attempt_key := 'wrong:'||ip_bucket||':'||team;
    INSERT INTO team_join_attempts(bucket,attempts,reset_at) VALUES(attempt_key,1,now()+interval '15 minutes')
      ON CONFLICT(bucket) DO UPDATE SET attempts=team_join_attempts.attempts+1;
    RETURN NULL;
  END IF;
  IF EXISTS(SELECT 1 FROM team_join_attempts WHERE bucket='wrong:'||ip_bucket||':'||team AND attempts>=5) THEN RETURN NULL; END IF;
  SELECT m.user_id INTO inviter FROM memberships m WHERE m.org_id=target.org_id AND m.role IN ('owner','admin')
    ORDER BY CASE WHEN m.role='owner' THEN 0 ELSE 1 END,m.created_at LIMIT 1;
  IF inviter IS NULL THEN RETURN NULL; END IF;
  -- Reissuing this exact address revokes only its earlier code-based invites.
  UPDATE invites SET status='revoked' WHERE org_id=target.org_id AND lower(email)=lower(address) AND status='pending'
    AND id IN (SELECT invite_id FROM team_join_code_invites WHERE org_id=target.org_id);
  INSERT INTO invites(org_id,email,role,token_hash,invited_by,expires_at)
    VALUES(target.org_id,lower(address),'scout',encode(digest(raw_token,'sha256'),'hex'),inviter,now()+interval '30 minutes')
    RETURNING id INTO invitation;
  INSERT INTO team_join_code_invites(org_id,invite_id) VALUES(target.org_id,invitation);
  INSERT INTO membership_audit_events(org_id,actor_user_id,action,target_email_hash)
    VALUES(target.org_id,inviter,'team.join_code.requested',encode(digest(lower(address),'sha256'),'hex'));
  RETURN invitation;
END $$;
REVOKE ALL ON FUNCTION request_team_code_invite(integer,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_team_code_invite(integer,text,text,text,text) TO vantage_app;
