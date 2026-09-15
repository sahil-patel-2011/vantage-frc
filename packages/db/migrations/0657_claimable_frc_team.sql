-- Public coach-start peek: unused official FRC number, without leaking why.
-- Also restates claim errors in student/coach language (no TBA jargon).

CREATE OR REPLACE FUNCTION peek_claimable_frc_team(candidate_team_number integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM teams_ref t
     WHERE t.team_number = candidate_team_number
       AND NOT EXISTS (
         SELECT 1 FROM organizations o WHERE o.team_number = candidate_team_number
       )
  );
$$;

REVOKE ALL ON FUNCTION peek_claimable_frc_team(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION peek_claimable_frc_team(integer) TO vantage_app, vantage_worker;

CREATE OR REPLACE FUNCTION claim_frc_team_workspace(
  p_name text,
  p_slug text,
  p_team_number integer
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  app_user users%ROWTYPE;
  org_id uuid;
BEGIN
  SELECT * INTO app_user FROM users WHERE id = current_app_user_id();
  IF app_user.id IS NULL OR NOT app_user.email_verified THEN
    RAISE EXCEPTION 'Sign in with Google or an email code first — that verifies the address';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'Team name is required';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Slug must use lowercase letters, numbers, and hyphens';
  END IF;
  IF p_team_number IS NULL OR p_team_number < 1 OR p_team_number > 99999 THEN
    RAISE EXCEPTION 'Team number must be between 1 and 99999';
  END IF;
  IF EXISTS (SELECT 1 FROM organizations WHERE team_number = p_team_number) THEN
    RAISE EXCEPTION 'This number cannot be claimed here. Ask a coach for a join link.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams_ref WHERE team_number = p_team_number) THEN
    RAISE EXCEPTION 'This number cannot be claimed here. Ask a coach for a join link, or try another unused team number.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM memberships WHERE user_id = app_user.id AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'This account already owns a team';
  END IF;

  INSERT INTO organizations(name, slug, team_number)
  VALUES (trim(p_name), p_slug, p_team_number)
  RETURNING id INTO org_id;

  INSERT INTO memberships(org_id, user_id, role) VALUES (org_id, app_user.id, 'owner');
  INSERT INTO org_billing(org_id, tier, credit_cap_usd, period_start, period_end)
  VALUES (
    org_id,
    'free',
    0,
    date_trunc('month', now()),
    date_trunc('month', now()) + interval '1 month'
  );
  INSERT INTO membership_audit_events(org_id, actor_user_id, action, metadata)
  VALUES (
    org_id,
    app_user.id,
    'organization.claimed',
    jsonb_build_object('teamNumber', p_team_number, 'slug', p_slug)
  );
  RETURN org_id;
END;
$$;
