-- A team could not see its own people.
--
-- `users` has RLS for vantage_app with exactly two read paths: your own row
-- (users_self_read, 0001) and every row for a platform admin (users_platform_read,
-- 0479). Product code names people by joining that table — 221 `JOIN users` sites
-- across apps/web and packages — so for an ordinary member every one of those
-- joins silently drops all rows but their own:
--
--   * /api/organizations/members listed the owner and nobody else, so the roster,
--     role changes, capability grants and hub access were unusable.
--   * The scouting bootstrap's "recent entries" panel was empty for the coach
--     while the scout who wrote the 36 entries saw all 36 (the entries themselves
--     are member-readable; the `JOIN users u ON u.id = e.scout_user_id` was not).
--   * Same shape in hours, attendance, calendar, tasks, duties, notebook,
--     inspection, messages and the rest.
--
-- This is a missing policy, not a deliberate restriction: the surfaces above are
-- designed to show teammate names, and the routes already gate on membership or
-- an org capability. Scope the new read to co-membership only, so a member sees
-- exactly the people they share a workspace with and nobody else.

CREATE OR REPLACE FUNCTION shares_org_with_current_user(candidate_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM memberships mine
    JOIN memberships theirs ON theirs.org_id = mine.org_id
    WHERE mine.user_id = current_app_user_id()
      AND theirs.user_id = candidate_user_id
  )
$$;
REVOKE ALL ON FUNCTION shares_org_with_current_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shares_org_with_current_user(uuid) TO vantage_app, vantage_worker;

DROP POLICY IF EXISTS users_co_member_read ON users;
CREATE POLICY users_co_member_read ON users FOR SELECT TO vantage_app
  USING (shares_org_with_current_user(id));
