-- Opt-in email notification preferences. All categories default OFF — never email without consent.
-- Distinct from profiles.notification_prefs (in-app alerts). Auth OTP / 2FA / invites are unaffected.

CREATE TABLE user_email_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  product_updates boolean NOT NULL DEFAULT false,
  coach_assignments boolean NOT NULL DEFAULT false,
  coach_todos boolean NOT NULL DEFAULT false,
  coach_practice_reminders boolean NOT NULL DEFAULT false,
  unsubscribe_token text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_email_preferences_token_len CHECK (char_length(unsubscribe_token) >= 24)
);
CREATE UNIQUE INDEX user_email_preferences_token_uq ON user_email_preferences (unsubscribe_token);

ALTER TABLE user_email_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_email_preferences_self ON user_email_preferences TO vantage_app
  USING (user_id = current_app_user_id())
  WITH CHECK (user_id = current_app_user_id());

CREATE POLICY user_email_preferences_platform_read ON user_email_preferences FOR SELECT TO vantage_app
  USING (is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON user_email_preferences TO vantage_app, vantage_worker;

-- Resolve a recipient only when the category is opted in. Used by coach/product senders
-- that cannot SELECT other users' emails under RLS (users_self_read).
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
    'coach_practice_reminders'
  ) THEN
    RETURN;
  END IF;

  SELECT
    CASE category
      WHEN 'product_updates' THEN p.product_updates
      WHEN 'coach_assignments' THEN p.coach_assignments
      WHEN 'coach_todos' THEN p.coach_todos
      WHEN 'coach_practice_reminders' THEN p.coach_practice_reminders
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
REVOKE ALL ON FUNCTION resolve_opt_in_email_recipient(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_opt_in_email_recipient(uuid, text) TO vantage_app, vantage_worker;

-- One-click unsubscribe by token (public route; no session). category = 'all' clears every opt-in.
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
  ELSE
    RETURN false;
  END IF;

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END $$;
REVOKE ALL ON FUNCTION apply_email_unsubscribe(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_email_unsubscribe(text, text) TO vantage_app, vantage_worker;

-- Platform-admin broadcast list for product/changelog emails (opted-in only).
CREATE OR REPLACE FUNCTION list_product_update_recipients()
RETURNS TABLE(user_id uuid, email text, unsubscribe_token text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'platform admin required';
  END IF;

  RETURN QUERY
  SELECT p.user_id, u.email, p.unsubscribe_token
  FROM user_email_preferences p
  JOIN users u ON u.id = p.user_id
  WHERE p.product_updates = true
    AND u.email IS NOT NULL
    AND btrim(u.email) <> '';
END $$;
REVOKE ALL ON FUNCTION list_product_update_recipients() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_product_update_recipients() TO vantage_app, vantage_worker;
