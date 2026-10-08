-- Explicit browser-session approval of a paired Onshape device. No raw cookies,
-- session tokens or Onshape credentials; expiry/revocation is checked per action.
CREATE TABLE cad_browser_pilot_enrollments (
  device_id uuid PRIMARY KEY REFERENCES cad_relay_devices(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  remembered_device_id uuid REFERENCES remembered_mfa_devices(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cad_browser_pilot_enrollments ENABLE ROW LEVEL SECURITY;
-- Deliberately no direct grants: only the narrowly checked functions can read/write.

CREATE OR REPLACE FUNCTION cad_browser_pilot_session_allowed(
  actor_id uuid, team_id uuid, approving_session uuid, remembered_id uuid, email_2fa_required boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  s public.sessions%ROWTYPE;
  p public.org_auth_policies%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.sessions WHERE id = approving_session
    AND user_id = actor_id AND expires_at > now();
  IF s.id IS NULL THEN RETURN false; END IF;
  -- Re-evaluate global enforcement on every request, including sessions approved
  -- before email delivery / the email second-factor requirement was enabled.
  IF email_2fa_required IS DISTINCT FROM false AND s.email_2fa_verified_at IS NULL THEN RETURN false; END IF;
  SELECT * INTO p FROM public.org_auth_policies WHERE org_id = team_id;
  IF p.org_id IS NULL OR NOT CASE s.auth_method
      WHEN 'google' THEN p.allow_google
      WHEN 'email_otp' THEN p.allow_email_otp
      WHEN 'password' THEN p.allow_password
      ELSE false END THEN RETURN false; END IF;
  IF p.mfa_policy = 'required' THEN
    IF NOT EXISTS (SELECT 1 FROM public.user_mfa_enrollments
        WHERE user_id = actor_id AND confirmed_at IS NOT NULL) THEN RETURN false; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.mfa_step_up_sessions
        WHERE user_id = actor_id AND org_id = team_id AND session_id = approving_session AND expires_at > now())
      AND NOT EXISTS (SELECT 1 FROM public.remembered_mfa_devices
        WHERE id = remembered_id AND user_id = actor_id AND revoked_at IS NULL AND expires_at > now()
          AND p.remembered_device_days > 0
          AND created_at + p.remembered_device_days * interval '1 day' > now()) THEN RETURN false; END IF;
  END IF;
  RETURN p.mfa_policy IN ('off', 'optional', 'required');
END $$;
REVOKE ALL ON FUNCTION cad_browser_pilot_session_allowed(uuid, uuid, uuid, uuid, boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION enroll_onshape_browser_pilot_device(
  paired_device uuid, approving_session uuid, verified_pilot_org uuid, remembered_hash text, email_2fa_required boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  actor uuid := public.current_app_user_id();
  remembered_id uuid;
BEGIN
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.cad_relay_devices d
      JOIN public.memberships m ON m.org_id = d.org_id AND m.user_id = d.user_id
      JOIN public.organizations o ON o.id = d.org_id
    WHERE d.id = paired_device AND d.user_id = actor AND d.org_id = verified_pilot_org
      AND o.team_number = 6925 AND d.platform = 'onshape' AND d.revoked_at IS NULL
      AND COALESCE('cad.jobs.monitor' = ANY(d.scopes), false)
  ) THEN RETURN false; END IF;
  SELECT id INTO remembered_id FROM public.remembered_mfa_devices
    WHERE token_hash = remembered_hash AND user_id = actor AND revoked_at IS NULL AND expires_at > now();
  IF NOT public.cad_browser_pilot_session_allowed(actor, verified_pilot_org, approving_session, remembered_id, email_2fa_required)
    THEN RETURN false; END IF;
  INSERT INTO public.cad_browser_pilot_enrollments(device_id, session_id, remembered_device_id)
    VALUES(paired_device, approving_session, remembered_id)
    ON CONFLICT(device_id) DO UPDATE SET session_id = excluded.session_id,
      remembered_device_id = excluded.remembered_device_id, approved_at = now();
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION enroll_onshape_browser_pilot_device(uuid, uuid, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enroll_onshape_browser_pilot_device(uuid, uuid, uuid, text, boolean) TO vantage_app;

CREATE OR REPLACE FUNCTION check_onshape_browser_pilot_device(
  device_hash text,
  verified_pilot_org uuid,
  email_2fa_required boolean
) RETURNS TABLE(allowed boolean, status text, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  d public.cad_relay_devices%ROWTYPE;
  e public.cad_browser_pilot_enrollments%ROWTYPE;
BEGIN
  IF device_hash IS NULL OR device_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT false, 'denied'::text, 'device_invalid'::text;
    RETURN;
  END IF;
  SELECT * INTO d FROM public.cad_relay_devices
    WHERE token_hash = device_hash AND revoked_at IS NULL;
  IF d.id IS NULL OR d.platform <> 'onshape'
      OR NOT COALESCE('cad.jobs.monitor' = ANY(d.scopes), false) THEN
    RETURN QUERY SELECT false, 'denied'::text, 'device_invalid'::text;
    RETURN;
  END IF;
  IF verified_pilot_org IS NULL OR d.org_id <> verified_pilot_org
      OR NOT EXISTS (
        SELECT 1 FROM public.memberships m JOIN public.organizations o ON o.id = m.org_id
        WHERE m.org_id = d.org_id AND m.user_id = d.user_id AND o.team_number = 6925
      ) THEN
    RETURN QUERY SELECT false, 'denied'::text, 'pilot_membership_required'::text;
    RETURN;
  END IF;
  SELECT * INTO e FROM public.cad_browser_pilot_enrollments WHERE device_id = d.id;
  IF e.device_id IS NULL OR NOT public.cad_browser_pilot_session_allowed(d.user_id, d.org_id, e.session_id, e.remembered_device_id, email_2fa_required) THEN
    RETURN QUERY SELECT false, 'denied'::text, 'team_sign_in_required'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT true, 'eligible'::text, 'pilot_member'::text;
END $$;

REVOKE ALL ON FUNCTION check_onshape_browser_pilot_device(text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_onshape_browser_pilot_device(text, uuid, boolean) TO vantage_pairing;
