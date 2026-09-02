-- Team-level Onshape connections.
--
-- cad_connections rows were strictly per (org_id, user_id): the RLS policy in
-- 0016_cad_workspace.sql required user_id = current_app_user_id(), so a mentor
-- connecting Onshape enabled nobody else on the team. This migration lets an
-- owner/admin promote their connection to a TEAM connection — a row with
-- user_id NULL that every org member may read (and therefore use through
-- withRls), while only owners/admins may create, rotate, or revoke it.
--
-- Resolution order in the app (apps/web/lib/cad/onshape-tokens.ts):
--   1. the caller's own connected row
--   2. the org's team row (user_id IS NULL)
--   3. server env API keys (ONSHAPE_ACCESS_KEY / ONSHAPE_SECRET_KEY)
--
-- The per-user policies are kept exactly as strict as before; they are only
-- split into per-command policies so the team policies can sit beside them.

ALTER TABLE cad_connections ALTER COLUMN user_id DROP NOT NULL;

-- At most one active team connection per org and platform.
CREATE UNIQUE INDEX cad_connections_team_active_idx
  ON cad_connections(org_id, platform)
  WHERE user_id IS NULL AND disabled_at IS NULL;

DROP POLICY IF EXISTS cad_connections_owner ON cad_connections;

-- Read: my own rows, plus the team rows of any org I belong to.
CREATE POLICY cad_connections_read ON cad_connections FOR SELECT TO vantage_app
  USING (is_org_member(org_id) AND (user_id = current_app_user_id() OR user_id IS NULL));

-- Per-user rows: unchanged semantics — only the owning user writes them.
CREATE POLICY cad_connections_owner_insert ON cad_connections FOR INSERT TO vantage_app
  WITH CHECK (org_id = current_app_org_id() AND user_id = current_app_user_id());
CREATE POLICY cad_connections_owner_update ON cad_connections FOR UPDATE TO vantage_app
  USING (org_id = current_app_org_id() AND user_id = current_app_user_id())
  WITH CHECK (org_id = current_app_org_id() AND user_id = current_app_user_id());
CREATE POLICY cad_connections_owner_delete ON cad_connections FOR DELETE TO vantage_app
  USING (org_id = current_app_org_id() AND user_id = current_app_user_id());

-- Team rows (user_id IS NULL): owner/admin only for every write.
CREATE POLICY cad_connections_team_insert ON cad_connections FOR INSERT TO vantage_app
  WITH CHECK (
    org_id = current_app_org_id() AND user_id IS NULL
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
  );
CREATE POLICY cad_connections_team_update ON cad_connections FOR UPDATE TO vantage_app
  USING (
    org_id = current_app_org_id() AND user_id IS NULL
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
  )
  WITH CHECK (
    org_id = current_app_org_id() AND user_id IS NULL
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
  );
CREATE POLICY cad_connections_team_delete ON cad_connections FOR DELETE TO vantage_app
  USING (
    org_id = current_app_org_id() AND user_id IS NULL
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
  );

-- Table grants to vantage_app and vantage_worker were issued in 0016 and still apply.
GRANT SELECT, INSERT, UPDATE, DELETE ON cad_connections TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------------------
-- Token maintenance for shared rows.
--
-- The team row is a COPY of the sharer's OAuth token set. Onshape hands back a
-- new refresh token on every refresh, so whichever copy refreshes first would
-- strand the other, and a plain member — who may READ the team row but never
-- UPDATE it under the policies above — could not persist a rotation at all.
--
-- This function is the one narrow exception to "owner/admin write team rows":
-- any org member may store a freshly refreshed credential blob on a connection
-- they are allowed to use (their own row, or the org's team row), and the write
-- fans out to every enabled row descended from the same OAuth grant (same org,
-- platform and external_account_ref) so all copies stay valid together. Nothing
-- else on the row — label, status, scopes, disabled_at — can be changed here.
-- Callers: apps/web/lib/cad/onshape-tokens.ts, apps/web/app/api/cad/route.ts,
-- and the OAuth callback (a sharer reconnecting heals the team copy).
CREATE OR REPLACE FUNCTION rotate_cad_connection_credentials(target_connection uuid, new_credentials text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c cad_connections%ROWTYPE; touched integer;
BEGIN
  IF new_credentials IS NULL OR length(new_credentials) = 0 THEN
    RAISE EXCEPTION 'Refreshed credentials must not be empty';
  END IF;
  SELECT * INTO c FROM cad_connections WHERE id = target_connection AND disabled_at IS NULL FOR UPDATE;
  IF c.id IS NULL THEN RETURN 0; END IF;
  IF NOT is_org_member(c.org_id) THEN
    RAISE EXCEPTION 'Not a member of this organization';
  END IF;
  IF c.user_id IS NOT NULL AND c.user_id IS DISTINCT FROM current_app_user_id() THEN
    RAISE EXCEPTION 'Only the owning user may rotate a personal CAD connection';
  END IF;
  UPDATE cad_connections
     SET encrypted_credentials = new_credentials, last_tested_at = now(), updated_at = now()
   WHERE org_id = c.org_id AND platform = c.platform AND status = 'connected' AND disabled_at IS NULL
     AND (id = c.id OR (c.external_account_ref IS NOT NULL AND external_account_ref = c.external_account_ref));
  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched;
END $$;
REVOKE ALL ON FUNCTION rotate_cad_connection_credentials(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rotate_cad_connection_credentials(uuid, text) TO vantage_app, vantage_worker;
