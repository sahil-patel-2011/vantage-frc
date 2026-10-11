-- View only means read-only, enforced in Postgres.
--
-- THE PROMISE
--   Team admin › Access offers "View only — Can look, can't change." Until now the
--   database did not keep it: hundreds of org-scoped tables had a write policy that
--   any member passes through is_org_member(org_id), so a viewer could create and
--   edit tasks, scouting entries, calendar events, CAD, inventory and the rest.
--   Money was already closed by 0714 (can_manage_finances refuses viewers).
--
-- THE RULE
--   On every org-scoped table (row level security on, an org_id column) a person
--   whose membership in that org is `viewer` cannot INSERT, UPDATE or DELETE rows of
--   that org through the request role (vantage_app). Three RESTRICTIVE policies per
--   table do it: view_only_no_insert, view_only_no_update, view_only_no_delete.
--   Restrictive policies AND with the permissive ones, so nothing that is refused
--   today becomes allowed; owners, admins and team members are untouched because
--   the check is false for them.
--
--   The exceptions are the person's OWN state, listed with a reason in
--   view_only_exempt_tables below: their settings, devices, inbox, read receipts,
--   onboarding and practice progress, security trail, feedback to Vantage, safety
--   reports, answers to forms sent to them, their own Ask AI conversations (Ask AI
--   is offered to every role, lib/ai/capabilities.ts) and their own membership
--   (leaving the team). Three exempt tables keep a narrower rule: a viewer never
--   inserts or updates a membership, their Ask AI threads stay private, and their
--   AI messages are never shared to the team.
--
--   TEAM CHAT: a viewer READS chat (conversations, messages, mentions and their own
--   read position, which lives in org_conversation_participants — no org_id, so it
--   is not touched here). Posting, starting conversations, pinning and linking are
--   team-data writes and are refused; no help article or product copy promises a
--   viewer can post. Reporting a message to admins stays open (youth protection).
--
-- WHO IS NOT AFFECTED
--   vantage_worker (BYPASSRLS jobs), SECURITY DEFINER functions (they run as the
--   table owner, which bypasses RLS: accepting an invite, recovery capture, money
--   guards), vantage_auth / vantage_billing / vantage_pairing / vantage_display and
--   the other service roles (the policies are TO vantage_app only), and FK cascades
--   (referential actions bypass RLS).
--
-- A REFUSAL SAYS WHY
--   The policies call refuse_view_only_write(org_id), which RAISEs 42501 with the
--   product sentence instead of returning false, so a refused write fails loudly
--   (not a silent "0 rows updated") and every route that repeats a plain error shows
--   "View only — you can look but not change this. Ask a team owner or admin for
--   Team member access." withRls() turns it into ViewOnlyError (HTTP 403).
--   UPDATE checks the NEW row (WITH CHECK) and keeps USING (true): an UPDATE policy's
--   USING also filters SELECT … FOR UPDATE, and read paths lock rows (billing,
--   pick lists, pairing polls). Rows are never re-homed to another org_id by request
--   code, so checking the new row's org is the whole rule.
--
-- FUTURE TABLES
--   A migration that adds an org-scoped table ends with
--     SELECT install_view_only_guards();
--   or, for genuinely personal state, first
--     INSERT INTO view_only_exempt_tables(table_name, reason, added_in) VALUES (…);
--   and then calls it (exempting a table also drops its three guard policies).
--   packages/db/src/view-only-integration.test.ts fails on any org-scoped table that
--   is neither guarded nor exempt, and view-only-migrations.test.ts checks new
--   migration files for the call without a database.
--
-- Safe to re-run: CREATE OR REPLACE functions, CREATE TABLE IF NOT EXISTS, upserted
-- exemptions, and policies created only when missing.

-- ---------------------------------------------------------------- the predicates

CREATE OR REPLACE FUNCTION is_org_viewer(target_org_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM memberships
     WHERE org_id = target_org_id
       AND user_id = current_app_user_id()
       AND role = 'viewer'::org_role
  )
$$;
REVOKE ALL ON FUNCTION is_org_viewer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_org_viewer(uuid) TO vantage_app, vantage_worker;

COMMENT ON FUNCTION is_org_viewer(uuid) IS
  'True when the current app user''s membership in that org is View only (role viewer).';

-- Returns true, or refuses with the sentence the product shows. Not SECURITY DEFINER:
-- it only reads through is_org_viewer, which is.
CREATE OR REPLACE FUNCTION refuse_view_only_write(target_org_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF target_org_id IS NOT NULL AND is_org_viewer(target_org_id) THEN
    RAISE EXCEPTION 'View only — you can look but not change this. Ask a team owner or admin for Team member access.'
      USING ERRCODE = 'insufficient_privilege', DETAIL = 'vantage:view_only';
  END IF;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION refuse_view_only_write(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refuse_view_only_write(uuid) TO vantage_app, vantage_worker;

COMMENT ON FUNCTION refuse_view_only_write(uuid) IS
  'Policy check for 0715: true, or RAISE 42501 (detail vantage:view_only) when the current app user is View only in that org.';

-- ---------------------------------------------------------------- the allowlist

CREATE TABLE IF NOT EXISTS view_only_exempt_tables (
  table_name text PRIMARY KEY,
  reason text NOT NULL CHECK (char_length(btrim(reason)) >= 12),
  added_in text NOT NULL
);
ALTER TABLE view_only_exempt_tables ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON view_only_exempt_tables FROM PUBLIC, vantage_app, vantage_auth, vantage_marketing;
GRANT SELECT ON view_only_exempt_tables TO vantage_worker;

COMMENT ON TABLE view_only_exempt_tables IS
  'Org-scoped tables a View only member may still write: their own state. Each row says why (0715).';

INSERT INTO view_only_exempt_tables (table_name, reason, added_in) VALUES
  -- Own settings, credentials and devices
  ('dashboards', 'Own personal dashboard layout; team (org-scope) dashboards stay owner/admin-only by their own policy.', '0715'),
  ('learning_mode_prefs', 'Own Learning-mode on/off preference (read by self and admins only).', '0715'),
  ('cad_user_preferences', 'Own CAD viewer preferences (self-only rows).', '0715'),
  ('scout_voice_user_prefs', 'Own voice-input preferences (self-only rows).', '0715'),
  ('member_llm_keys', 'Own personal AI provider key for Ask AI (self-only rows).', '0715'),
  ('cad_connections', 'Own Onshape sign-in; tokens are refreshed while simply reading CAD.', '0715'),
  ('cad_relay_devices', 'Revoking or signing out their own paired Fusion relay computer.', '0715'),
  ('editor_devices', 'Revoking their own paired code-editor device.', '0715'),
  ('ai_bridge_devices', 'Revoking or tuning their own paired AI bridge computer (paired_by = self).', '0715'),
  ('calendar_feed_tokens', 'Own private calendar-subscription link (create/rotate), read-only feed of team events.', '0715'),
  ('push_subscriptions', 'Own browser/phone push endpoints.', '0715'),
  ('grant_calendar_watchlist', 'Own grant-deadline reminder subscription (member_user_id = self).', '0715'),
  ('cad_change_radar_subscriptions', 'Own CAD change-alert subscription (user_id = self).', '0715'),
  -- Own inbox and read receipts
  ('notifications', 'Own inbox: mark read/dismiss, plus the invite-accepted notice a new member sends their leads on joining.', '0715'),
  ('announcement_acks', 'Read receipt: "I read this announcement" (user_id = self).', '0715'),
  -- Own onboarding, learning and practice progress (self + admins read)
  ('member_onboarding_tracks', 'Own onboarding track; GET /api/role-onboarding creates it on first view.', '0715'),
  ('member_onboarding_checks', 'Own onboarding checklist ticks (self-only rows).', '0715'),
  ('cad_learn_progress', 'Own CAD lesson progress (self and admins read).', '0715'),
  ('cad_learn_submissions', 'Own CAD practice submissions (self and admins read).', '0715'),
  ('learning_predictions', 'Own Learning-mode practice calls (self and admins read).', '0715'),
  ('judge_practice_sessions', 'Own judge-interview practice (self-only rows).', '0715'),
  -- Own security and audit trail
  ('mfa_step_up_sessions', 'Own two-factor step-up session (signing in to sensitive pages).', '0715'),
  ('auth_policy_audit_events', 'Audit row for their own security changes (two-factor enrolment and similar).', '0715'),
  ('membership_audit_events', 'The invite.accepted row written when they join; every other action needs owner/admin by policy.', '0715'),
  ('export_audit_events', 'Audit row written when they export or download (a read).', '0715'),
  -- Their own membership: leaving the team deletes their own row. Writes are owner/admin-only by
  -- memberships' own policies; view_only_membership_* still refuses a viewer INSERT/UPDATE.
  ('memberships', 'Leaving the team deletes their own membership; view_only_membership_* refuses viewer INSERT/UPDATE.', '0715'),
  -- Feedback to Vantage, not team data
  ('bug_reports', 'Own bug report to Vantage.', '0715'),
  ('support_tickets', 'Own support ticket to Vantage.', '0715'),
  ('beta_enrollments', 'Own opt-in to a Vantage beta.', '0715'),
  ('product_events', 'Own product-analytics events, sent while browsing.', '0715'),
  -- Safety and consent
  ('org_message_reports', 'Reporting a chat message to team admins (youth protection) must never be refused.', '0715'),
  ('hours_self_view_biometric_consents', 'Giving or withdrawing consent for their own biometric data must never be refused.', '0715'),
  -- Answers to forms sent to them (respondent and admins read)
  ('form_responses', 'Own answers to a team form (read by the respondent and admins only).', '0715'),
  ('form_answers', 'Own answers to a team form (read by the respondent and admins only).', '0715'),
  -- Ask AI, offered to every role (lib/ai/capabilities.ts ALL_MEMBERS)
  ('agent_threads', 'Own Ask AI threads; view_only_private_thread_* keeps a viewer''s threads private.', '0715'),
  ('agent_messages', 'Messages in own Ask AI threads; view_only_unshared_message_* stops sharing to the team.', '0715'),
  ('agent_context_usage', 'Token accounting for their own Ask AI turns.', '0715'),
  ('ai_runs', 'Run record of their own Ask AI turn.', '0715'),
  ('ai_run_steps', 'Steps of their own Ask AI run.', '0715'),
  ('ai_run_approvals', 'Their own request for an admin to approve an over-limit Ask AI run.', '0715'),
  ('ai_usage_events', 'Metering ledger row for their own AI use (meteredAI).', '0715'),
  ('api_usage_denials', 'Record of their own refused AI request, written by metering.', '0715'),
  ('autonomous_agent_runs', 'Their own read-only research agent run (agent is offered to every role).', '0715'),
  ('autonomous_agent_steps', 'Steps of their own research agent run.', '0715')
ON CONFLICT (table_name) DO UPDATE SET reason = EXCLUDED.reason;

-- ---------------------------------------------------------------- the installer

-- Adds the three guard policies to every org-scoped table that is not exempt, and
-- removes them from exempt ones, so the allowlist is the single source of truth.
-- Returns how many policies it created or dropped.
CREATE OR REPLACE FUNCTION install_view_only_guards() RETURNS integer
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  t record;
  changed integer := 0;
BEGIN
  FOR t IN
    SELECT c.oid, c.relname,
           EXISTS (SELECT 1 FROM view_only_exempt_tables e WHERE e.table_name = c.relname) AS exempt
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND NOT c.relispartition
       AND c.relrowsecurity
       AND EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
       )
     ORDER BY c.relname
  LOOP
    IF t.exempt THEN
      IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = t.oid AND polname = 'view_only_no_insert') THEN
        EXECUTE format('DROP POLICY view_only_no_insert ON public.%I', t.relname);
        changed := changed + 1;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = t.oid AND polname = 'view_only_no_update') THEN
        EXECUTE format('DROP POLICY view_only_no_update ON public.%I', t.relname);
        changed := changed + 1;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = t.oid AND polname = 'view_only_no_delete') THEN
        EXECUTE format('DROP POLICY view_only_no_delete ON public.%I', t.relname);
        changed := changed + 1;
      END IF;
      CONTINUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = t.oid AND polname = 'view_only_no_insert') THEN
      EXECUTE format(
        'CREATE POLICY view_only_no_insert ON public.%I AS RESTRICTIVE FOR INSERT TO vantage_app '
        'WITH CHECK (refuse_view_only_write(org_id))', t.relname);
      changed := changed + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = t.oid AND polname = 'view_only_no_update') THEN
      EXECUTE format(
        'CREATE POLICY view_only_no_update ON public.%I AS RESTRICTIVE FOR UPDATE TO vantage_app '
        'USING (true) WITH CHECK (refuse_view_only_write(org_id))', t.relname);
      changed := changed + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = t.oid AND polname = 'view_only_no_delete') THEN
      EXECUTE format(
        'CREATE POLICY view_only_no_delete ON public.%I AS RESTRICTIVE FOR DELETE TO vantage_app '
        'USING (refuse_view_only_write(org_id))', t.relname);
      changed := changed + 1;
    END IF;
  END LOOP;
  RETURN changed;
END
$$;
REVOKE ALL ON FUNCTION install_view_only_guards() FROM PUBLIC;

COMMENT ON FUNCTION install_view_only_guards() IS
  'Guards every org-scoped table against View only writes except view_only_exempt_tables (0715). Idempotent.';

SELECT install_view_only_guards();

-- ---------------------------------------------------------------- narrower rules on three exempt tables

DO $$
BEGIN
  -- A viewer never adds or changes a membership (their own role included); only a DELETE of
  -- their own row (leaving) is left to memberships' own policies.
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'memberships'::regclass AND polname = 'view_only_membership_insert') THEN
    CREATE POLICY view_only_membership_insert ON memberships AS RESTRICTIVE FOR INSERT TO vantage_app
      WITH CHECK (refuse_view_only_write(org_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'memberships'::regclass AND polname = 'view_only_membership_update') THEN
    CREATE POLICY view_only_membership_update ON memberships AS RESTRICTIVE FOR UPDATE TO vantage_app
      USING (true) WITH CHECK (refuse_view_only_write(org_id));
  END IF;
  -- A viewer's Ask AI threads are private: no team-scope thread, no switching one to team.
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'agent_threads'::regclass AND polname = 'view_only_private_thread_insert') THEN
    CREATE POLICY view_only_private_thread_insert ON agent_threads AS RESTRICTIVE FOR INSERT TO vantage_app
      WITH CHECK (CASE WHEN scope = 'private' THEN true ELSE refuse_view_only_write(org_id) END);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'agent_threads'::regclass AND polname = 'view_only_private_thread_update') THEN
    CREATE POLICY view_only_private_thread_update ON agent_threads AS RESTRICTIVE FOR UPDATE TO vantage_app
      USING (true)
      WITH CHECK (CASE WHEN scope = 'private' THEN true ELSE refuse_view_only_write(org_id) END);
  END IF;
  -- …and nothing they write to Ask AI is shared into a team thread.
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'agent_messages'::regclass AND polname = 'view_only_unshared_message_insert') THEN
    CREATE POLICY view_only_unshared_message_insert ON agent_messages AS RESTRICTIVE FOR INSERT TO vantage_app
      WITH CHECK (CASE WHEN NOT explicitly_shared THEN true ELSE refuse_view_only_write(org_id) END);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'agent_messages'::regclass AND polname = 'view_only_unshared_message_update') THEN
    CREATE POLICY view_only_unshared_message_update ON agent_messages AS RESTRICTIVE FOR UPDATE TO vantage_app
      USING (true)
      WITH CHECK (CASE WHEN NOT explicitly_shared THEN true ELSE refuse_view_only_write(org_id) END);
  END IF;
END $$;

-- ---------------------------------------------------------------- coverage, for tests and audits

CREATE OR REPLACE VIEW view_only_guard_coverage AS
SELECT c.relname::text AS table_name,
       e.table_name IS NOT NULL AS exempt,
       e.reason,
       EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'view_only_no_insert'
                 AND NOT p.polpermissive AND p.polcmd = 'a' AND p.polroles = (SELECT ARRAY[r.oid] FROM pg_roles r WHERE r.rolname = 'vantage_app'))
   AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'view_only_no_update'
                 AND NOT p.polpermissive AND p.polcmd = 'w' AND p.polroles = (SELECT ARRAY[r.oid] FROM pg_roles r WHERE r.rolname = 'vantage_app'))
   AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'view_only_no_delete'
                 AND NOT p.polpermissive AND p.polcmd = 'd' AND p.polroles = (SELECT ARRAY[r.oid] FROM pg_roles r WHERE r.rolname = 'vantage_app'))
       AS guarded
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN view_only_exempt_tables e ON e.table_name = c.relname
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'p')
   AND NOT c.relispartition
   AND c.relrowsecurity
   AND EXISTS (
     SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
   );
REVOKE ALL ON view_only_guard_coverage FROM PUBLIC;
GRANT SELECT ON view_only_guard_coverage TO vantage_worker;

COMMENT ON VIEW view_only_guard_coverage IS
  'Every org-scoped table: exempt (with reason) or guarded by the three 0715 View only policies.';
