-- Daily team performance email ("performance_digest"): default-ON email category
-- plus an idempotency log so cron re-runs never double-send.
--
-- Honesty rule: the worker only enumerates orgs with REAL data for the day
-- (scored matches involving the team, or scouting activity). No-data days write
-- no log rows and send nothing.

-- 1) Default-ON email category. NOT NULL DEFAULT true backfills existing prefs
--    rows, so every member is opted in until they unsubscribe.
ALTER TABLE user_email_preferences
  ADD COLUMN IF NOT EXISTS performance_digest boolean NOT NULL DEFAULT true;

-- 2) Extend the opt-in recipient resolver (last defined in 0173) with the new
--    category. Behavior for existing categories is unchanged.
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
    'sponsor_reminders',
    'performance_digest'
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
      WHEN 'performance_digest' THEN COALESCE(p.performance_digest, true)
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

-- 3) Unsubscribe by token: add the performance_digest branch and include it in
--    the 'all' sweep (last defined in 0173).
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
      performance_digest = false,
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
  ELSIF category = 'performance_digest' THEN
    UPDATE user_email_preferences SET performance_digest = false, updated_at = now()
    WHERE unsubscribe_token = btrim(raw_token);
  ELSE
    RETURN false;
  END IF;

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END $$;

-- 4) Send log: one row per (org, member, day). The worker claims the row
--    BEFORE sending (ON CONFLICT DO NOTHING), so a concurrent or repeated cron
--    run can never double-send; the final status is written after the attempt.
CREATE TABLE IF NOT EXISTS performance_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'skipped_pref', 'failed')),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT performance_email_log_uq UNIQUE (org_id, user_id, day)
);
CREATE INDEX IF NOT EXISTS performance_email_log_org_day_idx
  ON performance_email_log(org_id, day DESC);

ALTER TABLE performance_email_log ENABLE ROW LEVEL SECURITY;

-- Members may see their own delivery rows (e.g. "why did I / didn't I get
-- yesterday's digest"); only the worker writes.
DROP POLICY IF EXISTS performance_email_log_self_read ON performance_email_log;
CREATE POLICY performance_email_log_self_read ON performance_email_log FOR SELECT TO vantage_app
  USING (user_id = current_app_user_id() AND is_org_member(org_id));

GRANT SELECT ON performance_email_log TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON performance_email_log TO vantage_worker;
