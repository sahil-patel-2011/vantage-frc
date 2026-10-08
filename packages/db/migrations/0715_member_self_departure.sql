-- A member may leave only their own team. No general self-write RLS grant:
-- the definer owns the narrow, atomic operation and retains the audit trail.
CREATE FUNCTION public.leave_my_team(target_org uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  actor uuid := public.current_app_user_id();
  actor_role public.org_role;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE org_id=target_org AND user_id=actor) THEN
    RETURN 'already_left';
  END IF;
  -- Match the lock used by role changes and ownership handover.
  PERFORM id FROM public.organizations WHERE id=target_org FOR UPDATE;
  SELECT role INTO actor_role FROM public.memberships WHERE org_id=target_org AND user_id=actor FOR UPDATE;
  IF actor_role IS NULL THEN RETURN 'already_left'; END IF;
  IF actor_role='owner' THEN RETURN 'owner_required'; END IF;
  IF actor_role='admin' AND NOT EXISTS (
    SELECT 1 FROM public.memberships WHERE org_id=target_org AND user_id<>actor AND role IN ('owner','admin')
  ) THEN RETURN 'last_admin'; END IF;

  INSERT INTO public.membership_audit_events(org_id,actor_user_id,action,metadata)
    VALUES(target_org,actor,'member.left',jsonb_build_object('userId',actor,'role',actor_role));
  -- Leaving must not revive old capability grants on a later invitation.
  DELETE FROM public.membership_capabilities WHERE org_id=target_org AND user_id=actor;
  DELETE FROM public.membership_hub_access WHERE org_id=target_org AND user_id=actor;
  DELETE FROM public.team_subteam_members WHERE org_id=target_org AND user_id=actor;
  DELETE FROM public.member_scan_codes WHERE org_id=target_org AND user_id=actor;
  -- A pending duplicate invitation should not rejoin this person automatically.
  UPDATE public.invites SET status='revoked' WHERE org_id=target_org AND status='pending'
    AND lower(btrim(email))=(SELECT lower(btrim(email)) FROM public.users WHERE id=actor);
  DELETE FROM public.memberships WHERE org_id=target_org AND user_id=actor;
  RETURN 'left';
END $$;
REVOKE ALL ON FUNCTION public.leave_my_team(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_my_team(uuid) TO vantage_app;
