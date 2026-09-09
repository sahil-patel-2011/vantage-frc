-- The email spine: announcements, dues reminders, new-member onboarding.
--
-- Vantage already had opt-in email done properly — a per-category preference
-- row, a one-click unsubscribe token, a SECURITY DEFINER recipient resolver so
-- a sender never reads another member's address directly. What it did not have
-- were the categories for the three things teams actually chase people about.
--
-- WHY THREE NEW CATEGORIES AND NOT ONE MORE FLAG ON AN EXISTING ONE
--
-- Folding a dues reminder into `coach_todos` would mean a student who opts out
-- of todo email stops getting dues notices, and a parent who wants only dues
-- notices starts getting todos. This product is used by minors and their
-- guardians. Consent has to be per-thing, which means the enum, the column, the
-- unsubscribe branch and the preferences row all grow together — that is what
-- this migration is.
--
-- DEFAULTS
--
--   announcements      ON  — only `urgent` or `require_ack` announcements are
--                            ever emailed (see lib/announcements/notify-email).
--                            These are departure times, safety notices and
--                            permission deadlines from the member's own team;
--                            a normal announcement stays in the inbox only.
--   dues_reminders     ON  — nothing here is automatic. A treasurer opens the
--                            dues form's results and presses send, and the
--                            people who asked for financial assistance are
--                            excluded before the list is even built.
--   member_onboarding  ON  — a short, state-driven sequence for someone who
--                            has just joined a team, which sends nothing at all
--                            when the member has nothing outstanding.
--
-- Every one of them is one click to leave, from the footer of any message.

ALTER TABLE user_email_preferences
  ADD COLUMN IF NOT EXISTS announcements boolean NOT NULL DEFAULT true;
ALTER TABLE user_email_preferences
  ADD COLUMN IF NOT EXISTS dues_reminders boolean NOT NULL DEFAULT true;
ALTER TABLE user_email_preferences
  ADD COLUMN IF NOT EXISTS member_onboarding boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN user_email_preferences.announcements IS
  'Opt-in email for urgent / acknowledgement-required team announcements only';
COMMENT ON COLUMN user_email_preferences.dues_reminders IS
  'Opt-in email for dues reminders. Never sent to anyone whose dues answer asked for financial assistance.';
COMMENT ON COLUMN user_email_preferences.member_onboarding IS
  'Opt-in email for the new-member onboarding sequence (accounts only; never a form respondent with no account)';

-- ---------------------------------------------------------------------------
-- 1. Recipient resolution
-- ---------------------------------------------------------------------------

-- Extend the single-recipient resolver (last defined in 0450) with the three
-- new categories, and close a gap while we are in here.
--
-- The resolver is SECURITY DEFINER with EXECUTE granted to vantage_app and,
-- until now, no check on who was asking. It returns an address AND an
-- unsubscribe token, so any signed-in user who knew a user id — which co-members
-- do, from the roster — could read a teammate's token and use the public
-- one-click unsubscribe route to silence their mail for them.
--
-- The guard below is the narrowest one that changes no existing behaviour:
--   * worker connections (no app user set) are unaffected — that is every cron;
--   * you may always resolve yourself;
--   * otherwise you must share an org with the recipient, which every
--     request-path sender already does (a coach mailing an assignee, a lead
--     mailing a practice reminder).
-- What it stops is resolving someone in another team entirely.
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
  IF current_app_user_id() IS NOT NULL
     AND target_user_id <> current_app_user_id()
     AND NOT shares_org_with_current_user(target_user_id)
  THEN
    RETURN;
  END IF;

  IF category NOT IN (
    'product_updates',
    'coach_assignments',
    'coach_todos',
    'coach_practice_reminders',
    'sponsor_reminders',
    'performance_digest',
    'announcements',
    'dues_reminders',
    'member_onboarding'
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
      WHEN 'announcements' THEN COALESCE(p.announcements, true)
      WHEN 'dues_reminders' THEN COALESCE(p.dues_reminders, true)
      WHEN 'member_onboarding' THEN COALESCE(p.member_onboarding, true)
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

-- Bulk resolver, for a fan-out that would otherwise be one round trip per
-- member. An urgent announcement to a 60-person team should be one query and
-- then N sends, not 60 queries and N sends.
--
-- Scoped tighter than the singular resolver, because it hands back a list. A
-- request-path caller must be an owner or admin of an org the recipient belongs
-- to — which is exactly who sends a fan-out, since posting an announcement and
-- sending dues reminders are both leadership actions. A worker connection has
-- no app user set and is trusted. Anyone else gets nothing, including an
-- ordinary member enumerating their own teammates' unsubscribe tokens.
CREATE OR REPLACE FUNCTION resolve_opt_in_email_recipients(
  target_user_ids uuid[],
  category text
) RETURNS TABLE(user_id uuid, email text, unsubscribe_token text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF category NOT IN (
    'product_updates',
    'coach_assignments',
    'coach_todos',
    'coach_practice_reminders',
    'sponsor_reminders',
    'performance_digest',
    'announcements',
    'dues_reminders',
    'member_onboarding'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.user_id, u.email, p.unsubscribe_token
  FROM user_email_preferences p
  JOIN users u ON u.id = p.user_id
  WHERE p.user_id = ANY(target_user_ids)
    AND u.email IS NOT NULL
    AND btrim(u.email) <> ''
    AND CASE category
          WHEN 'product_updates' THEN p.product_updates
          WHEN 'coach_assignments' THEN p.coach_assignments
          WHEN 'coach_todos' THEN p.coach_todos
          WHEN 'coach_practice_reminders' THEN p.coach_practice_reminders
          WHEN 'sponsor_reminders' THEN p.sponsor_reminders
          WHEN 'performance_digest' THEN COALESCE(p.performance_digest, true)
          WHEN 'announcements' THEN COALESCE(p.announcements, true)
          WHEN 'dues_reminders' THEN COALESCE(p.dues_reminders, true)
          WHEN 'member_onboarding' THEN COALESCE(p.member_onboarding, true)
        END
    AND (
      current_app_user_id() IS NULL
      OR p.user_id = current_app_user_id()
      OR EXISTS (
        SELECT 1
        FROM memberships mine
        JOIN memberships theirs ON theirs.org_id = mine.org_id
        WHERE mine.user_id = current_app_user_id()
          AND mine.role IN ('owner', 'admin')
          AND theirs.user_id = p.user_id
      )
    );
END $$;
REVOKE ALL ON FUNCTION resolve_opt_in_email_recipients(uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_opt_in_email_recipients(uuid[], text) TO vantage_app, vantage_worker;

-- Materialise the default preferences row for people who have never opened the
-- preferences page.
--
-- Without this, a default-ON category silently under-sends. `sendOptInEmail`
-- resolves a recipient by joining `user_email_preferences`, and a member who has
-- never visited /notifications/preferences has no row — so an urgent
-- announcement or a dues reminder quietly skips exactly the newest members, the
-- ones most likely to need it.
--
-- The obvious fix — have the sender upsert the row — does not work and fails
-- loudly in the worst way: `user_email_preferences_self` (0142) allows a member
-- to write only their OWN row, so a treasurer's insert is refused by RLS, the
-- surrounding transaction aborts, and every statement after it in the same
-- request dies with "current transaction is aborted" — including the send log.
-- One member without a preferences row would take the whole send down.
--
-- So the row is created here, under definer rights, with the DEFAULTS and a
-- fresh unsubscribe token. This is not a consent change: it writes down what the
-- defaults already say, and it is what gives the person a token to leave with.
-- The caller must be the worker, the person themselves, or an owner/admin of an
-- org they share.
CREATE OR REPLACE FUNCTION ensure_email_preferences(target_user_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  created integer := 0;
BEGIN
  INSERT INTO user_email_preferences (user_id, product_updates, unsubscribe_token)
  SELECT u.id,
         true,
         -- base64url, matching newUnsubscribeToken() in @vantage/core; translate
         -- drops '=' because it has no replacement character.
         translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_')
    FROM unnest(target_user_ids) AS t(id)
    JOIN users u ON u.id = t.id
   WHERE u.email IS NOT NULL
     AND btrim(u.email) <> ''
     AND (
       current_app_user_id() IS NULL
       OR u.id = current_app_user_id()
       OR EXISTS (
         SELECT 1
         FROM memberships mine
         JOIN memberships theirs ON theirs.org_id = mine.org_id
         WHERE mine.user_id = current_app_user_id()
           AND mine.role IN ('owner', 'admin')
           AND theirs.user_id = u.id
       )
     )
  ON CONFLICT (user_id) DO NOTHING;

  GET DIAGNOSTICS created = ROW_COUNT;
  RETURN created;
END $$;
REVOKE ALL ON FUNCTION ensure_email_preferences(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_email_preferences(uuid[]) TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------------------
-- 2. Unsubscribe (last defined in 0450)
-- ---------------------------------------------------------------------------

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
      announcements = false,
      dues_reminders = false,
      member_onboarding = false,
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
  ELSIF category = 'announcements' THEN
    UPDATE user_email_preferences SET announcements = false, updated_at = now()
    WHERE unsubscribe_token = btrim(raw_token);
  ELSIF category = 'dues_reminders' THEN
    UPDATE user_email_preferences SET dues_reminders = false, updated_at = now()
    WHERE unsubscribe_token = btrim(raw_token);
  ELSIF category = 'member_onboarding' THEN
    UPDATE user_email_preferences SET member_onboarding = false, updated_at = now()
    WHERE unsubscribe_token = btrim(raw_token);
  ELSE
    RETURN false;
  END IF;

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Dues reminder send log
-- ---------------------------------------------------------------------------

-- One row per (form, member, day). The sender claims the row BEFORE sending, so
-- a treasurer who clicks twice, or two treasurers who both click, cannot double
-- chase the same student on the same day.
--
-- `kind` records WHY someone was reminded, and it is the audit trail for the
-- rule that matters most in this feature: 'assistance' rows are never written,
-- because an assistance answer never reaches the send list at all.
CREATE TABLE IF NOT EXISTS dues_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_on date NOT NULL DEFAULT (CURRENT_DATE),
  kind text NOT NULL CHECK (kind IN ('owing', 'no_response')),
  status text NOT NULL CHECK (status IN ('sent', 'skipped_pref', 'failed')),
  detail text,
  sent_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dues_reminder_log_uq UNIQUE (form_id, user_id, sent_on)
);
CREATE INDEX IF NOT EXISTS dues_reminder_log_org_idx ON dues_reminder_log (org_id, sent_on DESC);

ALTER TABLE dues_reminder_log ENABLE ROW LEVEL SECURITY;

-- A member can see the reminders they were sent — "why did I get this" has to
-- be answerable by the person who got it, not only by the treasurer.
DROP POLICY IF EXISTS dues_reminder_log_read ON dues_reminder_log;
CREATE POLICY dues_reminder_log_read ON dues_reminder_log FOR SELECT TO vantage_app
  USING (
    user_id = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

DROP POLICY IF EXISTS dues_reminder_log_admin_write ON dues_reminder_log;
CREATE POLICY dues_reminder_log_admin_write ON dues_reminder_log FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

DROP POLICY IF EXISTS dues_reminder_log_admin_update ON dues_reminder_log;
CREATE POLICY dues_reminder_log_admin_update ON dues_reminder_log FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE ON dues_reminder_log TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dues_reminder_log TO vantage_worker;

-- The treasurer-facing follow-up notice for people who asked for help. It
-- carries a COUNT and a link, never a name: the results page is where a lead
-- reads who, behind org RLS, rather than in an inbox that may be shared.
DROP POLICY IF EXISTS notifications_dues_peer_insert ON notifications;
CREATE POLICY notifications_dues_peer_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'dues_assistance_followup'
    AND org_id IS NOT NULL
    AND has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
        AND m.role IN ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 4. New-member onboarding
-- ---------------------------------------------------------------------------

-- When each email feature started running. Without this, switching the
-- onboarding sequence on would send "welcome to the team" to every member who
-- happens to have joined inside the lookback window — people who have been
-- using Vantage for weeks. The worker only considers memberships created at or
-- after the epoch, so turning the feature on is silent for everyone already here.
CREATE TABLE IF NOT EXISTS email_feature_epochs (
  feature text PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO email_feature_epochs (feature) VALUES ('member_onboarding')
  ON CONFLICT (feature) DO NOTHING;

ALTER TABLE email_feature_epochs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_feature_epochs_read ON email_feature_epochs;
CREATE POLICY email_feature_epochs_read ON email_feature_epochs FOR SELECT TO vantage_app
  USING (true);
GRANT SELECT ON email_feature_epochs TO vantage_app;
GRANT SELECT, INSERT ON email_feature_epochs TO vantage_worker;

-- One row per (member, stage). Claimed before sending, exactly like
-- performance_email_log, so a re-run of the cron cannot repeat a stage.
CREATE TABLE IF NOT EXISTS member_onboarding_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('welcome', 'first_week', 'settling_in')),
  status text NOT NULL CHECK (status IN ('sent', 'skipped_pref', 'skipped_nothing_due', 'failed')),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_onboarding_email_log_uq UNIQUE (org_id, user_id, stage)
);
CREATE INDEX IF NOT EXISTS member_onboarding_email_log_org_idx
  ON member_onboarding_email_log (org_id, created_at DESC);

ALTER TABLE member_onboarding_email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_onboarding_email_log_read ON member_onboarding_email_log;
CREATE POLICY member_onboarding_email_log_read ON member_onboarding_email_log FOR SELECT TO vantage_app
  USING (
    user_id = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT ON member_onboarding_email_log TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON member_onboarding_email_log TO vantage_worker;

-- ---------------------------------------------------------------------------
-- 5. Telling a team that a stranger answered their intake link
-- ---------------------------------------------------------------------------

-- A prospective student fills in a shared intake form. Nobody on the team is
-- told, because the public route has no session and cannot insert a
-- notification for anyone.
--
-- This is the in-app half of that, and deliberately ONLY the in-app half. The
-- respondent typed their email address into a question so a team could reach
-- them; that is not consent for Vantage to email them, there is no preferences
-- row, no unsubscribe token, no proof the address is theirs, and they are quite
-- possibly a minor. The path from "answered a form" to "can be emailed" is the
-- existing invite flow, where a lead makes a deliberate decision and the
-- recipient creates an account.
--
-- The notification carries the form title and a link, never the respondent's
-- name or answers: leadership reads those on the results page, behind RLS.
CREATE OR REPLACE FUNCTION notify_public_form_response(candidate_token text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_form forms%ROWTYPE;
  inserted integer := 0;
BEGIN
  SELECT * INTO target_form
    FROM forms
   WHERE share_token = candidate_token
     AND audience = 'link';

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  INSERT INTO notifications (user_id, org_id, type, payload)
  SELECT m.user_id,
         target_form.org_id,
         'form_response_received',
         jsonb_build_object(
           'title', 'New response on ' || target_form.title,
           'body', 'Someone answered through the shared link. Open the form to read it.',
           'formId', target_form.id,
           'formTitle', target_form.title,
           'purpose', target_form.purpose,
           'href', '/forms/' || target_form.id::text
         )
    FROM memberships m
   WHERE m.org_id = target_form.org_id
     AND m.role IN ('owner', 'admin');

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;
REVOKE ALL ON FUNCTION notify_public_form_response(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify_public_form_response(text) TO vantage_app, vantage_worker;
