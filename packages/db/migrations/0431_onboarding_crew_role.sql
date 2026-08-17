-- Per-person crew role + role description on onboarding.
-- Team number stays optional on profiles. Joining an existing team still requires
-- that team's approval via request_workspace_access — never auto-join.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS crew_role text,
  ADD COLUMN IF NOT EXISTS role_description text;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_crew_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_crew_role_check
  CHECK (
    crew_role IS NULL OR crew_role IN (
      'scout','driver','operator','mechanical','electrical','programming','cad','pit','business','other'
    )
  );

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_description_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_description_check
  CHECK (role_description IS NULL OR char_length(role_description) <= 280);

ALTER TABLE workspace_access_requests
  ADD COLUMN IF NOT EXISTS crew_role text,
  ADD COLUMN IF NOT EXISTS role_description text;

ALTER TABLE workspace_access_requests DROP CONSTRAINT IF EXISTS workspace_access_requests_crew_role_check;
ALTER TABLE workspace_access_requests ADD CONSTRAINT workspace_access_requests_crew_role_check
  CHECK (
    crew_role IS NULL OR crew_role IN (
      'scout','driver','operator','mechanical','electrical','programming','cad','pit','business','other'
    )
  );

ALTER TABLE workspace_access_requests DROP CONSTRAINT IF EXISTS workspace_access_requests_role_description_check;
ALTER TABLE workspace_access_requests ADD CONSTRAINT workspace_access_requests_role_description_check
  CHECK (role_description IS NULL OR char_length(role_description) <= 280);

DROP FUNCTION IF EXISTS request_workspace_access(integer, text, text);
DROP FUNCTION IF EXISTS request_workspace_access(integer, text, text, text, text);
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
  RETURN request_id;
END $$;

REVOKE ALL ON FUNCTION request_workspace_access(integer,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_workspace_access(integer,text,text,text,text) TO vantage_app;
