-- Desktop browser-link sign-in: the Windows shell (apps/desktop) never renders the
-- sign-in forms itself. It starts a link request carrying only a sha256 challenge of a
-- verifier it keeps in memory, shows the human 8-char code, and opens the user's REAL
-- browser to /desktop-link. The signed-in user approves the named machine + code there,
-- the desktop polls for a one-time authorization code, and exchanges code + original
-- verifier for a Better Auth session cookie minted server-side for the approving user.
--
-- Mirrors the pairing architecture of 0017/0018 (CAD relay), 0484 (storage nodes) and
-- 0486 (AI bridge): human code + poll token sha256-hashed at rest, the vantage_pairing
-- role for unauthenticated device traffic, and RLS binding approval to the approver.
--
-- Honesty rules baked in: every secret (user code, poll token, authorization code) is
-- stored ONLY as a sha256 hex hash — the authorization code plaintext exists solely in
-- the single poll response that releases it, and the verifier never reaches the server
-- at all (only its sha256 challenge does). Single use is structural: releasing the auth
-- code stamps auth_code_hash, exchanging stamps consumed_at, both under FOR UPDATE.

DO $$ BEGIN CREATE ROLE vantage_pairing NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO vantage_pairing;

CREATE TABLE desktop_link_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- sha256 hex of the normalized (dash-stripped, uppercased) human approval code.
  user_code_hash text UNIQUE NOT NULL,
  -- sha256 hex of the desktop's poll token.
  poll_token_hash text UNIQUE NOT NULL,
  -- sha256 hex of the PKCE-style verifier the desktop keeps in memory. The exchange
  -- must present the verifier whose hash matches; a stolen authorization code alone
  -- is useless.
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[0-9a-f]{64}$'),
  machine_name text NOT NULL,
  desktop_version text NOT NULL,
  -- Set by the signed-in approver; RLS forces it to be the approver themselves.
  approved_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  approved_at timestamptz,
  -- sha256 hex of the one-time authorization code, stamped when the poll releases the
  -- plaintext (exactly once). <= 5 minute TTL enforced via auth_code_expires_at.
  auth_code_hash text UNIQUE,
  auth_code_expires_at timestamptz,
  -- Stamped by the exchange; a consumed request can never mint a second session.
  consumed_at timestamptz,
  -- Whole-request TTL (<= 10 minutes): the window the user has to approve.
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX desktop_link_requests_machine_recent_idx
  ON desktop_link_requests(machine_name, created_at DESC);

ALTER TABLE desktop_link_requests ENABLE ROW LEVEL SECURITY;

-- Signed-in approver: preview a request by its code hash, and bind exactly themselves
-- as approver of an unclaimed, unexpired, unconsumed request. The WITH CHECK is the
-- database-level guarantee that approval binds the request to the approving user.
CREATE POLICY desktop_link_approve_read ON desktop_link_requests FOR SELECT TO vantage_app
  USING (current_app_user_id() IS NOT NULL);
CREATE POLICY desktop_link_approve_update ON desktop_link_requests FOR UPDATE TO vantage_app
  USING (approved_user_id IS NULL AND consumed_at IS NULL AND expires_at > now())
  WITH CHECK (approved_user_id = current_app_user_id());

-- Pairing role: unauthenticated desktop traffic (start / poll / exchange) through the
-- dedicated pool — never the request's withRls transaction.
CREATE POLICY desktop_link_service_insert ON desktop_link_requests FOR INSERT TO vantage_pairing WITH CHECK (true);
CREATE POLICY desktop_link_service_read ON desktop_link_requests FOR SELECT TO vantage_pairing USING (true);
CREATE POLICY desktop_link_service_update ON desktop_link_requests FOR UPDATE TO vantage_pairing USING (true) WITH CHECK (true);

GRANT SELECT, UPDATE ON desktop_link_requests TO vantage_app;
GRANT SELECT, INSERT, UPDATE ON desktop_link_requests TO vantage_pairing;
