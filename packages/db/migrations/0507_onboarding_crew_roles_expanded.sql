-- Widen the onboarding crew list to the subteams FRC teams actually run.
-- The original 10 covered build/drive/scout/business only, so design, media,
-- awards, outreach, strategy, safety and academics members all had to pick
-- "other" — which then resolved to the generic welcome tour instead of a
-- specialty track. `safety` was especially wrong: the safety track already
-- existed and could be auto-assigned from a subteam name, but nobody could
-- choose it at onboarding.
--
-- Existing rows keep their values; this only widens the allowed set.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_crew_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_crew_role_check
  CHECK (
    crew_role IS NULL OR crew_role IN (
      'scout','driver','operator','mechanical','electrical','programming','cad','pit','business',
      'design','media','awards','outreach','strategy','safety','academics',
      'other'
    )
  );

ALTER TABLE workspace_access_requests DROP CONSTRAINT IF EXISTS workspace_access_requests_crew_role_check;
ALTER TABLE workspace_access_requests ADD CONSTRAINT workspace_access_requests_crew_role_check
  CHECK (
    crew_role IS NULL OR crew_role IN (
      'scout','driver','operator','mechanical','electrical','programming','cad','pit','business',
      'design','media','awards','outreach','strategy','safety','academics',
      'other'
    )
  );
