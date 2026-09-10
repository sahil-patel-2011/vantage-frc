-- Team funding model: one choice at onboarding, not three independent checkboxes.
-- Flags stay in sync so existing Business/sponsor gates keep working.

DO $$ BEGIN
  CREATE TYPE org_funding_model AS ENUM (
    'self_funded',
    'school_funded_no_sponsors',
    'sponsored',
    'school_related_sponsored'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS funding_model org_funding_model;

UPDATE organizations SET funding_model = CASE
  WHEN school_funded IS TRUE AND COALESCE(sponsors_allowed, true) IS FALSE THEN 'school_funded_no_sponsors'::org_funding_model
  WHEN school_funded IS TRUE AND COALESCE(sponsors_allowed, true) IS TRUE THEN 'school_related_sponsored'::org_funding_model
  WHEN COALESCE(sponsors_allowed, false) IS TRUE AND COALESCE(school_funded, false) IS FALSE THEN 'sponsored'::org_funding_model
  WHEN school_funded IS FALSE AND COALESCE(sponsors_allowed, true) IS FALSE THEN 'self_funded'::org_funding_model
  ELSE funding_model
END
WHERE funding_model IS NULL
  AND (school_funded IS NOT NULL OR sponsors_allowed IS NOT NULL OR outside_grants IS NOT NULL);

COMMENT ON COLUMN organizations.funding_model IS
  'self_funded | school_funded_no_sponsors | sponsored | school_related_sponsored — set during owner onboarding. school_funded_no_sponsors hides sponsor surfaces.';
