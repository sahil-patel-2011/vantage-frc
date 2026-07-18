-- Peer-insert policies so coaches can notify scouts when their entries informed
-- a pick (CD #14) or when they earn a strategy-meeting seat (CD #16).

DROP POLICY IF EXISTS notifications_scout_pick_influence_insert ON notifications;
CREATE POLICY notifications_scout_pick_influence_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'scout_pick_influence'
    AND org_id IS NOT NULL
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );

DROP POLICY IF EXISTS notifications_scout_strategy_seat_insert ON notifications;
CREATE POLICY notifications_scout_strategy_seat_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'scout_strategy_seat'
    AND org_id IS NOT NULL
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );
