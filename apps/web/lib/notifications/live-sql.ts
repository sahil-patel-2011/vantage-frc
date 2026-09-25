/**
 * SQL for "this notification still points at something": an announcement notification whose
 * announcement was deleted is left out of the inbox and the unread counts. Tapping one opened
 * Announcements on "No announcements yet". A constant, never user input; it qualifies columns
 * with the table name, so it works in any query that reads `FROM notifications`.
 */
export const LIVE_NOTIFICATION_SQL = `NOT (
  notifications.type = 'team_announcement'
  AND notifications.payload ? 'announcementId'
  AND NOT EXISTS (
    SELECT 1 FROM team_announcements ta WHERE ta.id::text = notifications.payload->>'announcementId'
  )
)`;
