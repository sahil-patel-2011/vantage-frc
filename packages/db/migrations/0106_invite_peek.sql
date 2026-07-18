-- Read-only invite preview for the signed-in invitee (no membership required).
CREATE OR REPLACE FUNCTION peek_org_invite(raw_token text)
RETURNS TABLE (
  org_id uuid,
  org_name text,
  team_number integer,
  role text,
  email text,
  status text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM expire_org_invites();
  RETURN QUERY
  SELECT i.org_id,
         o.name,
         o.team_number,
         i.role::text,
         i.email,
         i.status::text,
         i.expires_at
  FROM invites i
  JOIN organizations o ON o.id = i.org_id
  WHERE i.token_hash = encode(digest(raw_token, 'sha256'), 'hex')
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION peek_org_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION peek_org_invite(text) TO vantage_app;
