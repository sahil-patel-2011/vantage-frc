-- Subteam progress for mentors and coaches.
--
-- Onboarding asks every member which subteam they are on (`profiles.crew_role`:
-- mechanical, electrical, programming, cad, scouting, pit, business, driver,
-- operator) and whether they are a student, mentor, coach or parent
-- (`profiles.team_role`). Nothing has ever been able to read it back, because
-- `profiles_self` (0001) restricts the table to the row you own. So the product
-- collected the org chart and then could not show it to the people who run the
-- team.
--
-- This is a SECURITY DEFINER reader rather than a widened RLS policy, for one
-- reason: `profiles` also holds date_of_birth, gender, phone_e164 and
-- recovery_email. A policy that let leads SELECT the row would expose all of
-- that. This function returns a fixed, narrow projection — name, role, subteam,
-- and progress counts — and there is no column list a caller can extend.
--
-- Access is limited to owners and admins of the org being asked about. Who has
-- not finished onboarding, who owes a form and who has not acknowledged a
-- safety notice is a leadership view; it is not something one student should be
-- able to pull about another.

CREATE OR REPLACE FUNCTION get_subteam_progress(candidate_org_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  team_role text,
  crew_role text,
  onboarded boolean,
  outstanding_forms integer,
  unacknowledged_notices integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.user_id,
         COALESCE(NULLIF(btrim(u.name), ''), u.email) AS display_name,
         p.team_role,
         p.crew_role,
         p.onboarding_completed_at IS NOT NULL AS onboarded,
         (
           SELECT count(*)::int
             FROM form_assignments fa
            WHERE fa.org_id = candidate_org_id
              AND fa.user_id = m.user_id
              AND NOT EXISTS (
                    SELECT 1 FROM form_responses fr
                     WHERE fr.form_id = fa.form_id
                       AND fr.respondent_user_id = m.user_id
                  )
         ) AS outstanding_forms,
         (
           SELECT count(*)::int
             FROM team_announcements a
            WHERE a.org_id = candidate_org_id
              AND a.require_ack
              AND NOT EXISTS (
                    SELECT 1 FROM announcement_acks k
                     WHERE k.announcement_id = a.id
                       AND k.user_id = m.user_id
                  )
         ) AS unacknowledged_notices
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN profiles p ON p.user_id = m.user_id
   WHERE m.org_id = candidate_org_id
     -- The caller must be a lead of THIS org. Checked inside the function
     -- because SECURITY DEFINER means RLS is not doing it for us.
     AND EXISTS (
           SELECT 1 FROM memberships caller
            WHERE caller.org_id = candidate_org_id
              AND caller.user_id = current_app_user_id()
              AND caller.role IN ('owner', 'admin')
         )
   ORDER BY p.crew_role NULLS LAST, display_name
$$;

REVOKE ALL ON FUNCTION get_subteam_progress(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_subteam_progress(uuid) TO vantage_app, vantage_worker;
