-- Peer-insert policies so coaches/leads can create inbox rows for other org members
-- when assigning duties or scheduling calendar events. Todos already have
-- notifications_todo_peer_insert (0141). Overlapping INSERT policies are OR'd.

DROP POLICY IF EXISTS notifications_duty_peer_insert ON notifications;
CREATE POLICY notifications_duty_peer_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'duty_assigned'
    AND org_id IS NOT NULL
    AND is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );

DROP POLICY IF EXISTS notifications_calendar_peer_insert ON notifications;
CREATE POLICY notifications_calendar_peer_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type IN ('calendar_event', 'calendar_updated')
    AND org_id IS NOT NULL
    AND is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );
