-- Peer-insert so TBA sync / My Day can fan out match_alert inbox rows to
-- org members (gated by profiles.notification_prefs.matchAlerts).

DROP POLICY IF EXISTS notifications_match_alert_peer_insert ON notifications;
CREATE POLICY notifications_match_alert_peer_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'match_alert'
    AND org_id IS NOT NULL
    AND is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );
