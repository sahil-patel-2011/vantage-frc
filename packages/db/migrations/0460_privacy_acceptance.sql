-- 0460_privacy_acceptance.sql
-- Terms of Service and Privacy Policy become two separate, independently
-- required consents. Migration 0163 stored a single combined checkbox in
-- profiles.terms_accepted_at / terms_version, so it cannot tell us whether any
-- given user ever agreed to the Privacy Policy on its own.
--
-- NOTHING IS BACKFILLED, ON PURPOSE. Copying terms_accepted_at into
-- privacy_accepted_at would manufacture a consent record for a person who was
-- never shown a separate Privacy Policy checkbox. Existing accounts are simply
-- asked again the next time they hit a consent gate (onboarding, invite accept,
-- or claiming a team workspace).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS privacy_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_version text;

COMMENT ON COLUMN profiles.privacy_accepted_at IS
  'Timestamp when the user separately accepted the then-current Privacy Policy. Never backfilled from terms_accepted_at (0163): a combined Terms+Privacy checkbox is not evidence of a separate privacy consent.';
COMMENT ON COLUMN profiles.privacy_version IS
  'Document version string (e.g. 2026-08-17) accepted with privacy_accepted_at.';
