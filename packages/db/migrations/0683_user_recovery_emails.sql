-- A second, verified email per person for account recovery.
--
-- If someone loses their main mailbox (a school account that ends, a Google sign-in
-- they can no longer use), a 6-digit code sent to this address signs them in. It is an
-- auth-layer table, read and written only by the auth role (vantage_auth) through
-- packages/core/src/recovery-email.ts, exactly like users/sessions/verifications.
--
-- A recovery address only counts once it is verified, and a verified address belongs to
-- one person: two accounts can never share a recovery mailbox.

CREATE TABLE IF NOT EXISTS user_recovery_emails (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_recovery_emails_normalized CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 6 AND 254)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_recovery_emails_verified_email
  ON user_recovery_emails (email) WHERE verified_at IS NOT NULL;

ALTER TABLE user_recovery_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_recovery_emails_auth_store ON user_recovery_emails;
CREATE POLICY user_recovery_emails_auth_store ON user_recovery_emails
  FOR ALL TO vantage_auth USING (true) WITH CHECK (true);

-- The app role may only see its own row (e.g. an account page read through withRls).
DROP POLICY IF EXISTS user_recovery_emails_self_read ON user_recovery_emails;
CREATE POLICY user_recovery_emails_self_read ON user_recovery_emails
  FOR SELECT TO vantage_app USING (user_id = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON user_recovery_emails TO vantage_auth;
GRANT SELECT ON user_recovery_emails TO vantage_app;
GRANT SELECT, DELETE ON user_recovery_emails TO vantage_worker;

-- Send counter for recovery codes (the auth role cannot read auth_audit_events).
-- key is "add:<user id>" or "signin:<sha256 of the address>" — never a raw address.
CREATE TABLE IF NOT EXISTS auth_recovery_sends (
  id bigserial PRIMARY KEY,
  key text NOT NULL CHECK (length(key) BETWEEN 5 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_recovery_sends_key_time ON auth_recovery_sends (key, created_at DESC);

ALTER TABLE auth_recovery_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_recovery_sends_auth_store ON auth_recovery_sends;
CREATE POLICY auth_recovery_sends_auth_store ON auth_recovery_sends
  FOR ALL TO vantage_auth USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, DELETE ON auth_recovery_sends TO vantage_auth;
GRANT USAGE, SELECT ON SEQUENCE auth_recovery_sends_id_seq TO vantage_auth;
GRANT SELECT, DELETE ON auth_recovery_sends TO vantage_worker;
