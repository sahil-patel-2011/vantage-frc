-- Join requests must reach team heads immediately, and requesters must hear the
-- decision. Two pieces:
--   1. request_workspace_access() fans out an in-app notification to every
--      owner/admin inside the same SECURITY DEFINER transaction that stores the
--      request — a plain requester session cannot read the admin roster, so the
--      fan-out lives here rather than in app code.
--   2. Peer-insert RLS policies so the reviewer's session may insert the
--      approval/decline notification for the requester (cross-user insert),
--      mirroring the notifications_duty_peer_insert pattern from 0146.

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

  -- Fan out to every team head in the same transaction as the request itself,
  -- so an admin is never left unaware of a pending person. SECURITY DEFINER
  -- runs as the schema owner, which legitimately sees the roster.
  SELECT COALESCE(NULLIF(btrim(name), ''), email) INTO requester_name FROM users WHERE id=actor;
  INSERT INTO notifications (user_id, org_id, type, payload)
  SELECT m.user_id, candidate_org_id, 'team_access_request',
         jsonb_build_object(
           'requestId', request_id,
           'orgId', candidate_org_id,
           'requesterName', COALESCE(requester_name, 'A new member'),
           'teamNumber', o.team_number,
           'href', '/team#team-access-title'
         )
  FROM memberships m
  JOIN organizations o ON o.id = m.org_id
  WHERE m.org_id = candidate_org_id
    AND m.role = ANY(ARRAY['owner','admin']::org_role[]);

  RETURN request_id;
END $$;

REVOKE ALL ON FUNCTION request_workspace_access(integer,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_workspace_access(integer,text,text,text,text) TO vantage_app;

-- The reviewer (owner/admin) notifies the requester of the decision from an
-- ordinary app session. Approved: the requester is a member by then; the row is
-- org-scoped. Declined: the requester never became a member, so the row keeps
-- org_id NULL and is validated against the reviewed request instead.
DROP POLICY IF EXISTS notifications_access_approved_peer_insert ON notifications;
CREATE POLICY notifications_access_approved_peer_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'team_access_approved'
    AND org_id IS NOT NULL
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND EXISTS (
      SELECT 1 FROM workspace_access_requests r
      WHERE r.org_id = notifications.org_id
        AND r.user_id = notifications.user_id
        AND r.status = 'approved'
    )
  );

DROP POLICY IF EXISTS notifications_access_declined_peer_insert ON notifications;
CREATE POLICY notifications_access_declined_peer_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'team_access_declined'
    AND org_id IS NULL
    AND EXISTS (
      SELECT 1 FROM workspace_access_requests r
      WHERE r.user_id = notifications.user_id
        AND r.status = 'declined'
        AND has_org_role(r.org_id, ARRAY['owner','admin']::org_role[])
    )
  );

-- Belt-and-braces: allow an owner/admin session to re-ping fellow heads about a
-- pending request (the SECURITY DEFINER fan-out above is the primary path).
DROP POLICY IF EXISTS notifications_access_request_peer_insert ON notifications;
CREATE POLICY notifications_access_request_peer_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'team_access_request'
    AND org_id IS NOT NULL
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
        AND m.role = ANY(ARRAY['owner','admin']::org_role[])
    )
  );
