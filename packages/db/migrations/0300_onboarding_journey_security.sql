-- Resumable, role-aware onboarding and the missing closed-workspace access-request store.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS primary_focus text,
  ADD COLUMN IF NOT EXISTS onboarding_current_step text NOT NULL DEFAULT 'profile',
  ADD COLUMN IF NOT EXISTS onboarding_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_saved_at timestamptz;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_primary_focus_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_primary_focus_check
  CHECK (primary_focus IS NULL OR primary_focus IN ('competition','build','business','leadership'));
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_onboarding_current_step_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_onboarding_current_step_check
  CHECK (onboarding_current_step IN ('profile','team','preferences','complete'));

CREATE TABLE IF NOT EXISTS workspace_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_team_role text,
  primary_focus text NOT NULL CHECK (primary_focus IN ('competition','build','business','leadership')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','withdrawn')),
  membership_role org_role,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

-- Keep the migration deployable in databases that were previously bootstrapped from the ORM schema.
ALTER TABLE workspace_access_requests
  ADD COLUMN IF NOT EXISTS requested_team_role text,
  ADD COLUMN IF NOT EXISTS primary_focus text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS membership_role org_role,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS workspace_access_requests_org_status_idx
  ON workspace_access_requests(org_id, status, created_at);
CREATE INDEX IF NOT EXISTS workspace_access_requests_user_created_idx
  ON workspace_access_requests(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_access_requests_org_user_uq
  ON workspace_access_requests(org_id, user_id);

ALTER TABLE workspace_access_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_access_requests_self_read ON workspace_access_requests;
CREATE POLICY workspace_access_requests_self_read ON workspace_access_requests FOR SELECT TO vantage_app
  USING (user_id = current_app_user_id());
DROP POLICY IF EXISTS workspace_access_requests_team_heads_read ON workspace_access_requests;
CREATE POLICY workspace_access_requests_team_heads_read ON workspace_access_requests FOR SELECT TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT ON workspace_access_requests TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_access_requests TO vantage_worker;

-- Request access without exposing the organizations table to a non-member.
-- Existing Neon copy returns TABLE(...); CREATE OR REPLACE cannot change return type.
DROP FUNCTION IF EXISTS request_workspace_access(integer, text, text);
CREATE OR REPLACE FUNCTION request_workspace_access(
  candidate_team_number integer,
  candidate_team_role text,
  candidate_primary_focus text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  candidate_org_id uuid;
  request_id uuid;
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

  SELECT id INTO candidate_org_id FROM organizations
   WHERE team_number = candidate_team_number ORDER BY created_at ASC LIMIT 1;
  IF candidate_org_id IS NULL THEN
    RAISE EXCEPTION 'No Vantage workspace exists for FRC team % yet. Ask a team leader to create it first.', candidate_team_number;
  END IF;
  IF EXISTS (SELECT 1 FROM memberships WHERE org_id=candidate_org_id AND user_id=actor) THEN
    RETURN NULL;
  END IF;

  INSERT INTO workspace_access_requests(org_id,user_id,requested_team_role,primary_focus,status)
  VALUES(candidate_org_id,actor,candidate_team_role,candidate_primary_focus,'pending')
  ON CONFLICT (org_id,user_id) DO UPDATE SET
    requested_team_role=excluded.requested_team_role,
    primary_focus=excluded.primary_focus,
    status='pending', membership_role=NULL, reviewed_by=NULL, reviewed_at=NULL, updated_at=now()
  RETURNING id INTO request_id;
  RETURN request_id;
END $$;

-- Minimal self-only workspace status used by onboarding; sensitive demographics never leave profiles.
DROP FUNCTION IF EXISTS onboarding_workspace_for_current_user();
CREATE OR REPLACE FUNCTION onboarding_workspace_for_current_user()
RETURNS TABLE(
  org_id uuid, team_number integer, org_name text, member_role text,
  access_status text, request_id uuid, request_created_at timestamptz,
  city text, state_prov text, description text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH actor AS (SELECT current_app_user_id() AS id),
  candidates AS (
    SELECT o.id org_id,o.team_number,o.name org_name,m.role::text member_role,
           'approved'::text access_status,NULL::uuid request_id,NULL::timestamptz request_created_at,
           o.city,o.state_prov,o.description,0 priority
      FROM actor a JOIN memberships m ON m.user_id=a.id JOIN organizations o ON o.id=m.org_id
    UNION ALL
    SELECT o.id,o.team_number,o.name,NULL::text,'invited',NULL::uuid,i.created_at,
           o.city,o.state_prov,o.description,1
      FROM actor a JOIN users u ON u.id=a.id JOIN invites i ON lower(i.email)=lower(u.email)
      JOIN organizations o ON o.id=i.org_id
     WHERE i.status='pending' AND i.expires_at>now()
    UNION ALL
    SELECT o.id,o.team_number,o.name,NULL::text,r.status,r.id,r.created_at,
           o.city,o.state_prov,o.description,2
      FROM actor a JOIN workspace_access_requests r ON r.user_id=a.id
      JOIN organizations o ON o.id=r.org_id
  )
  SELECT org_id,team_number,org_name,member_role,access_status,request_id,request_created_at,
         city,state_prov,description
    FROM candidates ORDER BY priority,request_created_at DESC NULLS LAST LIMIT 1
$$;

-- Atomic team-head review: authorization, request state, and membership grant are one transaction.
DROP FUNCTION IF EXISTS review_workspace_access(uuid, text, org_role);
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
  IF candidate_role NOT IN ('scout','viewer') THEN RAISE EXCEPTION 'Invalid membership role'; END IF;
  SELECT * INTO req FROM workspace_access_requests WHERE id=candidate_request_id FOR UPDATE;
  IF req.id IS NULL OR NOT has_org_role(req.org_id, ARRAY['owner','admin']::org_role[]) THEN
    RAISE EXCEPTION 'Pending access request not found';
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

REVOKE ALL ON FUNCTION request_workspace_access(integer,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION onboarding_workspace_for_current_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION review_workspace_access(uuid,text,org_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_workspace_access(integer,text,text),
  onboarding_workspace_for_current_user(),review_workspace_access(uuid,text,org_role) TO vantage_app;
