-- Self-serve graduation exit interviews. An owner/admin mints a one-time link
-- for an outgoing member; the member fills the form without signing in (they
-- may already have lost team access), and the response lands in
-- exit_interview_responses through the same write path the mentor form uses.
--
-- Token handling copies the parent-view capability-token shape (0471): the
-- opaque token lives only in the link, the table stores its sha256, and an
-- unauthenticated resolver is SECURITY DEFINER returning NULL for unknown
-- tokens — no unauthenticated dump, no cross-org leak. The resolver returns
-- only what the respond page needs (org name/team number, the invitee's own
-- name, season) plus the ids the server uses to scope the write.

CREATE TABLE IF NOT EXISTS exit_interview_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The outgoing member when they are (still) a Vantage user.
  member_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Otherwise (or additionally) the email the link was handed to.
  member_email text CHECK (
    member_email IS NULL OR (
      char_length(member_email) <= 254
      AND member_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )
  ),
  member_name text NOT NULL CHECK (char_length(member_name) BETWEEN 1 AND 200),
  season_year integer NOT NULL CHECK (season_year BETWEEN 1992 AND 3000),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  response_id uuid REFERENCES exit_interview_responses(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (member_user_id IS NOT NULL OR member_email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS exit_interview_invites_org_idx
  ON exit_interview_invites(org_id, season_year, created_at DESC);

ALTER TABLE exit_interview_invites ENABLE ROW LEVEL SECURITY;

-- Invites name a departing member and carry a capability: owners/admins only.
DROP POLICY IF EXISTS exit_interview_invites_admin_select ON exit_interview_invites;
DROP POLICY IF EXISTS exit_interview_invites_admin_insert ON exit_interview_invites;
DROP POLICY IF EXISTS exit_interview_invites_admin_update ON exit_interview_invites;
DROP POLICY IF EXISTS exit_interview_invites_admin_delete ON exit_interview_invites;
CREATE POLICY exit_interview_invites_admin_select ON exit_interview_invites
  FOR SELECT TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY exit_interview_invites_admin_insert ON exit_interview_invites
  FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND created_by = current_app_user_id()
  );
CREATE POLICY exit_interview_invites_admin_update ON exit_interview_invites
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY exit_interview_invites_admin_delete ON exit_interview_invites
  FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON exit_interview_invites TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------------------
-- Token resolver for the public respond page (same shape as get_parent_view).
-- Takes the sha256 of the link token, never the token itself. Returns NULL for
-- unknown or revoked tokens; used/expired invites come back with their state so
-- the page can say so honestly instead of pretending the link never existed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_exit_interview_invite(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  invite exit_interview_invites%ROWTYPE;
  result jsonb;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO invite FROM exit_interview_invites
  WHERE token_hash = p_token_hash AND revoked_at IS NULL;
  IF invite.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'inviteId', invite.id::text,
    'orgId', invite.org_id::text,
    'orgName', o.name,
    'teamNumber', o.team_number,
    'memberName', invite.member_name,
    'memberUserId', invite.member_user_id::text,
    'seasonYear', invite.season_year,
    'createdBy', invite.created_by::text,
    'expiresAt', invite.expires_at,
    'usedAt', invite.used_at,
    'expired', invite.expires_at <= now()
  )
  INTO result
  FROM organizations o
  WHERE o.id = invite.org_id;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION get_exit_interview_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_exit_interview_invite(text) TO vantage_app, vantage_worker;
