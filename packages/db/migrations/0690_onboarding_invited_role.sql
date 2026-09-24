-- Onboarding knows the role someone was invited with.
--
-- onboarding_workspace_for_current_user (0300) returned member_role NULL for a pending
-- invite, so the owner a platform admin had just created (and a mentor invited as
-- "Mentor or coach") started onboarding with "Student" already picked: the app only
-- knew their role once they had joined. The invite row carries the role; return it.
-- Nothing else changes, and the app treats NULL as before, so code does not depend on
-- this running first.

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
    SELECT o.id,o.team_number,o.name,i.role::text,'invited',NULL::uuid,i.created_at,
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

REVOKE ALL ON FUNCTION onboarding_workspace_for_current_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION onboarding_workspace_for_current_user() TO vantage_app;
