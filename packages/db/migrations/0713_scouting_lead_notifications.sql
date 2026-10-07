-- Scouting coordinators include delegated leads as well as team administrators.
-- Preserve same-team recipients and the scouting-specific sender capability.
DROP POLICY IF EXISTS notifications_scouting_disagreement_insert ON notifications;
CREATE POLICY notifications_scouting_disagreement_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'scouting_disagreement_resolved'
    AND org_id IS NOT NULL
    AND can_manage_scouting(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
        AND (m.role IN ('owner', 'admin') OR EXISTS (
          SELECT 1 FROM membership_capabilities c
          WHERE c.org_id = m.org_id AND c.user_id = m.user_id
            AND c.capability = 'manage_scouting'::org_capability
        ))
    )
  );
