-- Platform-owner analytics + team provisioning support.
--
-- No rollup table: every number on /admin/analytics is computed from existing
-- rows at read time. What this migration adds instead:
--
-- 1. RLS paths the platform-admin cockpit and the add-team flow genuinely need
--    but never had under the strict vantage_app role:
--    * users: platform admins could not resolve the first owner's verified
--      account (createOrganizationAsPlatformAdmin's lookup returned zero rows
--      under users_self_read), and the Global Team Manager / audit log always
--      showed NULL owner and actor emails.
--    * org_billing: organization provisioning seeds the org's billing row, but
--      vantage_app had neither an INSERT grant nor an INSERT policy.
--    * admin_actions: writeAdminAction() records privileged actions, but
--      vantage_app had SELECT only — the platform audit trail could never be
--      written from request paths.
--    * invites: platform admins provision a pending OWNER invite when the
--      first owner has no verified account yet; invites policies were
--      org-member scoped only.
--
-- 2. Two SECURITY DEFINER aggregate functions for cross-org activity. They are
--    deliberately count-only: platform admins get per-org/per-day event counts
--    and distinct-actor counts, never message bodies, scouting payloads, or any
--    other member content. Both fail closed unless is_platform_admin().

-- --- 1a. Platform admins may read user identity rows (email, verified flag). --
DROP POLICY IF EXISTS users_platform_read ON users;
CREATE POLICY users_platform_read ON users FOR SELECT TO vantage_app
  USING (is_platform_admin());

-- --- 1b. Provisioning seeds the org's billing row. ---------------------------
GRANT INSERT ON org_billing TO vantage_app;
DROP POLICY IF EXISTS org_billing_platform_provision ON org_billing;
CREATE POLICY org_billing_platform_provision ON org_billing FOR INSERT TO vantage_app
  WITH CHECK (is_platform_admin());

-- --- 1c. writeAdminAction() can actually land rows in admin_actions. ---------
GRANT INSERT ON admin_actions TO vantage_app;
DROP POLICY IF EXISTS admin_actions_platform_insert ON admin_actions;
CREATE POLICY admin_actions_platform_insert ON admin_actions FOR INSERT TO vantage_app
  WITH CHECK (is_platform_admin() AND actor_user_id = current_app_user_id());

-- --- 1d. Platform admins manage the one-time OWNER invite they provision. ----
-- (Table grants for invites already exist from 0001.)
DROP POLICY IF EXISTS invites_platform_read ON invites;
CREATE POLICY invites_platform_read ON invites FOR SELECT TO vantage_app
  USING (is_platform_admin());
DROP POLICY IF EXISTS invites_platform_provision ON invites;
CREATE POLICY invites_platform_provision ON invites FOR INSERT TO vantage_app
  WITH CHECK (is_platform_admin());
DROP POLICY IF EXISTS invites_platform_rotate ON invites;
CREATE POLICY invites_platform_rotate ON invites FOR UPDATE TO vantage_app
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- --- 2a. Per-org, per-day, per-source activity counts. -----------------------
-- "Activity" = any member-created row. Sources mirror the team-dream digest's
-- read-only map of activity tables; ai_usage_events rounds out metered AI use.
-- Counts only — no content columns ever leave this function.
CREATE OR REPLACE FUNCTION platform_activity_daily(since_day date, target_org uuid DEFAULT NULL)
RETURNS TABLE(org_id uuid, day date, source text, events bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- UTC midnight of since_day, independent of the session TimeZone, so the
  -- window boundary matches the UTC day bucketing below.
  since_ts timestamptz := since_day::timestamp AT TIME ZONE 'UTC';
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrator access required';
  END IF;
  RETURN QUERY
  SELECT a.o, a.d, a.s, count(*)::bigint
  FROM (
    SELECT m.org_id AS o, (m.created_at AT TIME ZONE 'UTC')::date AS d, 'messages'::text AS s
      FROM org_messages m WHERE m.deleted_at IS NULL AND m.created_at >= since_ts
    UNION ALL
    SELECT e.org_id, (e.created_at AT TIME ZONE 'UTC')::date, 'scouting'
      FROM match_scout_entries e WHERE e.created_at >= since_ts
    UNION ALL
    SELECT p.org_id, (p.created_at AT TIME ZONE 'UTC')::date, 'scouting'
      FROM pit_scout_entries p WHERE p.created_at >= since_ts
    UNION ALL
    SELECT t.org_id, (t.created_at AT TIME ZONE 'UTC')::date, 'tasks'
      FROM build_tasks t WHERE t.created_at >= since_ts
    UNION ALL
    SELECT td.org_id, (td.created_at AT TIME ZONE 'UTC')::date, 'tasks'
      FROM team_todos td WHERE td.created_at >= since_ts
    UNION ALL
    SELECT h.org_id, (h.clock_in AT TIME ZONE 'UTC')::date, 'hours'
      FROM hour_logs h WHERE h.clock_in >= since_ts
    UNION ALL
    SELECT dr.org_id, (dr.created_at AT TIME ZONE 'UTC')::date, 'decisions'
      FROM decision_records dr WHERE dr.created_at >= since_ts
    UNION ALL
    SELECT c.org_id, (c.created_at AT TIME ZONE 'UTC')::date, 'cad'
      FROM cad_jobs c WHERE c.created_at >= since_ts
    UNION ALL
    SELECT ir.org_id, (ir.created_at AT TIME ZONE 'UTC')::date, 'incidents'
      FROM incident_reports ir WHERE ir.created_at >= since_ts
    UNION ALL
    SELECT ae.org_id, (ae.created_at AT TIME ZONE 'UTC')::date, 'ai'
      FROM ai_usage_events ae WHERE ae.created_at >= since_ts
  ) a
  WHERE target_org IS NULL OR a.o = target_org
  GROUP BY a.o, a.d, a.s;
END $$;
REVOKE ALL ON FUNCTION platform_activity_daily(date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_activity_daily(date, uuid) TO vantage_app;

-- --- 2b. Distinct active members per org (plus one org_id IS NULL row = ------
-- platform-wide distinct, which is not the sum of per-org rows when a user
-- belongs to more than one org).
CREATE OR REPLACE FUNCTION platform_active_members(since_ts timestamptz)
RETURNS TABLE(org_id uuid, active_members bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrator access required';
  END IF;
  RETURN QUERY
  WITH actors AS (
    SELECT m.org_id AS o, m.author_user_id AS u
      FROM org_messages m WHERE m.deleted_at IS NULL AND m.created_at >= since_ts
    UNION ALL
    SELECT e.org_id, e.scout_user_id FROM match_scout_entries e WHERE e.created_at >= since_ts
    UNION ALL
    SELECT p.org_id, p.scout_user_id FROM pit_scout_entries p WHERE p.created_at >= since_ts
    UNION ALL
    SELECT t.org_id, t.created_by FROM build_tasks t WHERE t.created_at >= since_ts
    UNION ALL
    SELECT td.org_id, td.created_by FROM team_todos td WHERE td.created_at >= since_ts
    UNION ALL
    SELECT h.org_id, h.user_id FROM hour_logs h WHERE h.clock_in >= since_ts
    UNION ALL
    SELECT dr.org_id, dr.created_by FROM decision_records dr WHERE dr.created_at >= since_ts
    UNION ALL
    SELECT c.org_id, c.created_by FROM cad_jobs c WHERE c.created_at >= since_ts
    UNION ALL
    SELECT ir.org_id, ir.created_by FROM incident_reports ir WHERE ir.created_at >= since_ts
    UNION ALL
    SELECT ae.org_id, ae.user_id FROM ai_usage_events ae WHERE ae.created_at >= since_ts
  )
  SELECT actors.o, count(DISTINCT actors.u)::bigint FROM actors GROUP BY actors.o
  UNION ALL
  SELECT NULL::uuid, count(DISTINCT actors.u)::bigint FROM actors;
END $$;
REVOKE ALL ON FUNCTION platform_active_members(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_active_members(timestamptz) TO vantage_app;
