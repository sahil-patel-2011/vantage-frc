-- weight_settings is the shared inspection limit for the season.
-- Any member could change it. Component rows stay member-writable.
-- The limit stays with owners and admins.

DROP POLICY IF EXISTS weight_settings_write ON weight_settings;

CREATE POLICY weight_settings_admin_insert ON weight_settings FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND updated_by = current_app_user_id()
  );
CREATE POLICY weight_settings_admin_update ON weight_settings FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND updated_by = current_app_user_id()
  );
CREATE POLICY weight_settings_admin_delete ON weight_settings FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
