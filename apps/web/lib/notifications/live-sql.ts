/**
 * SQL for "this notification still points at something": an announcement notification whose
 * announcement was deleted is left out of the inbox and the unread counts. Tapping one opened
 * Announcements on "No announcements yet". A constant, never user input; it qualifies columns
 * with the table name, so it works in any query that reads `FROM notifications`.
 *
 * The announcement is found by its primary key (uuid = uuid). It used to compare
 * `ta.id::text = payload->>'announcementId'`, which no index can serve: every announcement
 * notification in the inbox scanned the whole announcements table. Only a canonical
 * lower-case uuid string is cast (the CASE keeps a malformed payload from raising), so the
 * rows that match are exactly the ones the text comparison matched.
 */
export const LIVE_NOTIFICATION_SQL = `NOT (
  notifications.type = 'team_announcement'
  AND notifications.payload ? 'announcementId'
  AND NOT EXISTS (
    SELECT 1 FROM team_announcements ta
    WHERE ta.id = CASE
      WHEN notifications.payload->>'announcementId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (notifications.payload->>'announcementId')::uuid
    END
  )
)`;
