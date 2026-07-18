-- Sponsor CRM auto-reminders: thank-you / renewal / overdue follow-up.
-- In-app notifications to org owners/admins + opt-in email category (default OFF).
-- Dedup table prevents daily-cron duplicate nudges for the same due date.

CREATE TABLE IF NOT EXISTS sponsor_reminder_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('thank_you', 'renewal', 'follow_up')),
  due_on date NOT NULL,
  notified_on date NOT NULL DEFAULT (CURRENT_DATE),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsor_reminder_events_uq UNIQUE (org_id, sponsor_id, kind, due_on)
);

CREATE INDEX IF NOT EXISTS sponsor_reminder_events_org_notified_idx
  ON sponsor_reminder_events (org_id, notified_on DESC);

ALTER TABLE sponsor_reminder_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sponsor_reminder_events_member_read ON sponsor_reminder_events;
CREATE POLICY sponsor_reminder_events_member_read ON sponsor_reminder_events FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

DROP POLICY IF EXISTS sponsor_reminder_events_admin_write ON sponsor_reminder_events;
CREATE POLICY sponsor_reminder_events_admin_write ON sponsor_reminder_events FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON sponsor_reminder_events TO vantage_app, vantage_worker;

DROP POLICY IF EXISTS notifications_sponsor_reminder_peer_insert ON notifications;
CREATE POLICY notifications_sponsor_reminder_peer_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type IN ('sponsor_thank_you_due', 'sponsor_renewal_due', 'sponsor_followup_overdue')
    AND org_id IS NOT NULL
    AND is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
        AND m.role IN ('owner', 'admin')
    )
  );

ALTER TABLE user_email_preferences
  ADD COLUMN IF NOT EXISTS sponsor_reminders boolean NOT NULL DEFAULT false;

COMMENT ON TABLE sponsor_reminder_events IS
  'Dedup log for org-scoped thank-you / renewal / overdue follow-up sponsor reminders';
COMMENT ON COLUMN user_email_preferences.sponsor_reminders IS
  'Opt-in email for team-facing sponsor CRM reminders (never auto-emails external sponsors)';
