-- Org affiliation + funding model — drives Business/Media Soft-UI (e.g. hide sponsors
-- for private schools that self-fund and disallow external sponsors).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS team_affiliation text
    CHECK (
      team_affiliation IS NULL
      OR team_affiliation IN ('private_school', 'public_school', 'community')
    ),
  ADD COLUMN IF NOT EXISTS school_funded boolean,
  ADD COLUMN IF NOT EXISTS outside_grants boolean,
  ADD COLUMN IF NOT EXISTS sponsors_allowed boolean;

COMMENT ON COLUMN organizations.team_affiliation IS
  'private_school | public_school | community — set during owner onboarding';
COMMENT ON COLUMN organizations.school_funded IS
  'True when the school/district primarily funds the team';
COMMENT ON COLUMN organizations.outside_grants IS
  'True when the team pursues external grants';
COMMENT ON COLUMN organizations.sponsors_allowed IS
  'False hides sponsor Soft-UI surfaces; null = show all (legacy orgs)';
