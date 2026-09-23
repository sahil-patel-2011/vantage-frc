-- The sponsor wall is a public thank-you page.
-- Any member could add a name, publish an entry, or turn the public link on.
-- Reads stay open to members. Writes stay with owners and admins.

DROP POLICY IF EXISTS sponsor_wall_entries_member_insert ON sponsor_wall_entries;
DROP POLICY IF EXISTS sponsor_wall_entries_member_update ON sponsor_wall_entries;
DROP POLICY IF EXISTS sponsor_wall_entries_member_delete ON sponsor_wall_entries;

CREATE POLICY sponsor_wall_entries_admin_insert ON sponsor_wall_entries FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND created_by = current_app_user_id()
  );
CREATE POLICY sponsor_wall_entries_admin_update ON sponsor_wall_entries FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY sponsor_wall_entries_admin_delete ON sponsor_wall_entries FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

DROP POLICY IF EXISTS sponsor_wall_settings_member_insert ON sponsor_wall_settings;
DROP POLICY IF EXISTS sponsor_wall_settings_member_update ON sponsor_wall_settings;
DROP POLICY IF EXISTS sponsor_wall_settings_member_delete ON sponsor_wall_settings;

CREATE POLICY sponsor_wall_settings_admin_insert ON sponsor_wall_settings FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND updated_by = current_app_user_id()
  );
CREATE POLICY sponsor_wall_settings_admin_update ON sponsor_wall_settings FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND updated_by = current_app_user_id()
  );
CREATE POLICY sponsor_wall_settings_admin_delete ON sponsor_wall_settings FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
