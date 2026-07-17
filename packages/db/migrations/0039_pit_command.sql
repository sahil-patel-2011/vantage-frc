ALTER TABLE robot_failures ADD COLUMN resolved_at timestamptz, ADD COLUMN resolved_by uuid REFERENCES users(id);

DROP POLICY IF EXISTS failures_member ON robot_failures;
CREATE POLICY failures_member_read ON robot_failures FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY failures_member_insert ON robot_failures FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND recorded_by = current_app_user_id());
CREATE POLICY failures_member_update ON robot_failures FOR UPDATE TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id) AND (resolved_by IS NULL OR resolved_by = current_app_user_id()));

DROP POLICY IF EXISTS maintenance_member_read ON maintenance_items;
DROP POLICY IF EXISTS maintenance_admin_write ON maintenance_items;
CREATE POLICY maintenance_member_read ON maintenance_items FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY maintenance_member_insert ON maintenance_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY maintenance_member_update ON maintenance_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id) AND (completed_by IS NULL OR completed_by = current_app_user_id()));
CREATE POLICY maintenance_admin_delete ON maintenance_items FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON robot_failures, maintenance_items TO vantage_app;
