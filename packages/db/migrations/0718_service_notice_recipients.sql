-- Outage contact list (apps/web/lib/outage/recipients.ts).
--
-- When the NAS database is down, the outage console still has to be able to email everyone
-- "Vantage is limited right now". It can't read the users table then, so while the database is
-- healthy the app keeps a sealed (AES-256-GCM) copy of the addresses in a separate key-value
-- store. This function is what that copy is taken from: the distinct email of every user with
-- at least one team membership, plus every platform admin.
--
-- SECURITY DEFINER because it reads across every team. It refuses anyone who is not a
-- platform admin (current_app_user_id() in platform_admins, set by withRls), and only
-- vantage_app may call it at all.

CREATE OR REPLACE FUNCTION list_service_notice_recipients()
RETURNS TABLE(email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = current_app_user_id()) THEN
    RAISE EXCEPTION 'platform admin required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT lower(btrim(u.email)) AS email
  FROM users u
  WHERE u.email IS NOT NULL
    AND btrim(u.email) <> ''
    AND (
      EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
      OR EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = u.id)
    )
  ORDER BY 1;
END $$;

REVOKE ALL ON FUNCTION list_service_notice_recipients() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_service_notice_recipients() TO vantage_app;
