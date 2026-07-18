ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text;

COMMENT ON COLUMN profiles.terms_accepted_at IS
  'Timestamp when the user accepted the then-current Terms of Service and Privacy Policy.';
COMMENT ON COLUMN profiles.terms_version IS
  'Document version string (e.g. 2026-07-17) accepted with terms_accepted_at.';