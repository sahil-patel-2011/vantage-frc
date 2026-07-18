-- Idempotent follow-up when 0155_sponsor_reminders already applied without email resolve.
-- Extends (does not duplicate) sponsor reminder prefs + opt-in email plumbing.

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

ALTER TABLE user_email_preferences
  ADD COLUMN IF NOT EXISTS sponsor_reminders boolean NOT NULL DEFAULT false;

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

CREATE OR REPLACE FUNCTION resolve_opt_in_email_recipient(
  target_user_id uuid,
  category text
) RETURNS TABLE(email text, unsubscribe_token text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  enabled boolean := false;
  token text;
  recipient text;
BEGIN
  IF category NOT IN (
    'product_updates',
    'coach_assignments',
    'coach_todos',
    'coach_practice_reminders',
    'sponsor_reminders'
  ) THEN
    RETURN;
  END IF;

  SELECT
    CASE category
      WHEN 'product_updates' THEN p.product_updates
      WHEN 'coach_assignments' THEN p.coach_assignments
      WHEN 'coach_todos' THEN p.coach_todos
      WHEN 'coach_practice_reminders' THEN p.coach_practice_reminders
      WHEN 'sponsor_reminders' THEN p.sponsor_reminders
    END,
    p.unsubscribe_token
  INTO enabled, token
  FROM user_email_preferences p
  WHERE p.user_id = target_user_id;

  IF NOT COALESCE(enabled, false) OR token IS NULL THEN
    RETURN;
  END IF;

  SELECT u.email INTO recipient
  FROM users u
  WHERE u.id = target_user_id AND u.email IS NOT NULL AND btrim(u.email) <> '';

  IF recipient IS NULL THEN
    RETURN;
  END IF;

  email := recipient;
  unsubscribe_token := token;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION apply_email_unsubscribe(
  raw_token text,
  category text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  updated integer := 0;
BEGIN
  IF raw_token IS NULL OR char_length(btrim(raw_token)) < 24 THEN
    RETURN false;
  END IF;

  IF category = 'all' OR category IS NULL OR btrim(category) = '' THEN
    UPDATE user_email_preferences SET
      product_updates = false,
      coach_assignments = false,
      coach_todos = false,
      coach_practice_reminders = false,
      sponsor_reminders = false,
      updated_at = now()
    WHERE unsubscribe_token = btrim(raw_token);
  ELSIF category = 'product_updates' THEN
    UPDATE user_email_preferences SET product_updates = false, updated_at = now()
    WHERE unsubscribe_token = btrim(raw_token);
  ELSIF category = 'coach_assignments' THEN
    UPDATE user_email_preferences SET coach_assignments = false, updated_at = now()
    WHERE unsubscribe_token = btrim(raw_token);
  ELSIF category = 'coach_todos' THEN
    UPDATE user_email_preferences SET coach_todos = false, updated_at = now()
    WHERE unsubscribe_token = btrim(raw_token);
  ELSIF category = 'coach_practice_reminders' THEN
    UPDATE user_email_preferences SET coach_practice_reminders = false, updated_at = now()
    WHERE unsubscribe_token = btrim(raw_token);
  ELSIF category = 'sponsor_reminders' THEN
    UPDATE user_email_preferences SET sponsor_reminders = false, updated_at = now()
    WHERE unsubscribe_token = btrim(raw_token);
  ELSE
    RETURN false;
  END IF;

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END $$;
