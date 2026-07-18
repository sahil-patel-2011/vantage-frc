-- Peer-insert for mid-event scouting coverage gap nudges to scout coordinators.
DROP POLICY IF EXISTS notifications_scouting_gap_insert ON notifications;
CREATE POLICY notifications_scouting_gap_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'scouting_coverage_gap'
    AND org_id IS NOT NULL
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );
