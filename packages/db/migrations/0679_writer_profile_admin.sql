-- writer_profile is one shared pitch identity per team and season.
-- Any member could overwrite the mission and the funding ask. Drafts stay
-- member-writable. Profile writes stay with owners and admins.

DROP POLICY IF EXISTS writer_profile_member_write ON writer_profile;

CREATE POLICY writer_profile_admin_insert ON writer_profile FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND created_by = current_app_user_id()
  );
CREATE POLICY writer_profile_admin_update ON writer_profile FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY writer_profile_admin_delete ON writer_profile FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
