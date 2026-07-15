-- Platform-wide email OTP second factor: session is not elevated until verified.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS email_2fa_verified_at timestamptz;

CREATE INDEX IF NOT EXISTS sessions_email_2fa_pending_idx
  ON sessions (user_id)
  WHERE email_2fa_verified_at IS NULL;
