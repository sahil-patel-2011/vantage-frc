-- Request-denominated AI credits, platform-pushed access grants, and team join codes.
--
-- Why a second credit unit: every existing credit surface (org_billing.credit_cap_usd,
-- wallet_ledger.amount_usd, ai_credit_grants.amount_usd) is denominated in DOLLARS and
-- tracks real provider spend. That stays exactly as it is. This migration adds a
-- parallel REQUEST budget so the platform can hand a team "500 AI requests" without
-- pretending to know what they will cost. One request costs one credit at the base
-- weight; an agentic loop that fans out into many model calls costs more, per
-- ai_credit_weights. Balance is always SUM(ledger) — there is no denormalized counter,
-- matching the dollar path in packages/billing.

-- ---------------------------------------------------------------------------
-- Tunable weights. Platform-admin editable so the chat/agentic ratio can change
-- without a deploy. credits = 0 means "metered for accounting, never charged".
CREATE TABLE ai_credit_weights (
  request_kind text PRIMARY KEY
    CHECK (request_kind IN ('chat','agentic','background','stt','embedding','deterministic')),
  credits integer NOT NULL CHECK (credits >= 0),
  description text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ai_credit_weights(request_kind, credits, description) VALUES
  ('chat',          1, 'Single-turn chat or one-shot model call'),
  ('agentic',       4, 'Multi-step agent loop with tool calls and repeated model turns'),
  ('background',    1, 'Queued overnight / relay job'),
  ('stt',           1, 'Speech-to-text transcription'),
  ('embedding',     0, 'Embeddings — not charged against request credits'),
  ('deterministic', 0, 'On-server compute with no external model call');

-- ---------------------------------------------------------------------------
-- Signed ledger. Positive rows are grants, negative rows are consumption.
-- request_id is the same idempotency key meteredAI already uses, so a retried
-- request can never double-charge.
CREATE TABLE ai_request_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_kind text NOT NULL CHECK (entry_kind IN ('grant','consumption','revoke','expiry')),
  credits integer NOT NULL CHECK (credits <> 0),
  request_kind text REFERENCES ai_credit_weights(request_kind),
  feature text,
  request_id text UNIQUE,
  expires_at timestamptz,
  actor_user_id uuid REFERENCES users(id),
  reason text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (entry_kind <> 'grant' OR credits > 0),
  CHECK (entry_kind = 'grant' OR credits < 0),
  CHECK (entry_kind = 'grant' OR expires_at IS NULL)
);
CREATE INDEX ai_request_credit_ledger_org_created_idx
  ON ai_request_credit_ledger(org_id, created_at DESC);
CREATE INDEX ai_request_credit_ledger_org_active_grant_idx
  ON ai_request_credit_ledger(org_id, expires_at)
  WHERE entry_kind = 'grant';

COMMENT ON COLUMN ai_request_credit_ledger.request_id IS
  'Mirrors ai_usage_events.request_id so a retried metered call is charged at most once.';
COMMENT ON COLUMN ai_request_credit_ledger.expires_at IS
  'Grants only. An expired grant simply stops counting toward the balance; no sweeper job is required.';

-- Balance = every grant still inside its window, minus everything spent.
-- security_invoker keeps the caller's RLS in force.
CREATE VIEW org_ai_request_credits WITH (security_invoker = true) AS
SELECT
  l.org_id,
  COALESCE(SUM(l.credits) FILTER (
    WHERE l.entry_kind = 'grant' AND (l.expires_at IS NULL OR l.expires_at > now())
  ), 0)::bigint AS granted,
  COALESCE(-SUM(l.credits) FILTER (WHERE l.entry_kind <> 'grant'), 0)::bigint AS spent,
  COALESCE(SUM(l.credits) FILTER (
    WHERE l.entry_kind <> 'grant'
       OR l.expires_at IS NULL
       OR l.expires_at > now()
  ), 0)::bigint AS balance
FROM ai_request_credit_ledger l
GROUP BY l.org_id;

-- ---------------------------------------------------------------------------
-- Time-boxed platform AI access. This generalizes the hardcoded team-1111 window in
-- packages/billing/src/sponsored-promo.ts into a real row a platform admin can grant,
-- extend, or revoke per team.
CREATE TABLE org_ai_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  access_kind text NOT NULL
    CHECK (access_kind IN ('platform_relay','sponsored_pool','hosted_platform')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  revoked_at timestamptz,
  granted_by uuid NOT NULL REFERENCES users(id),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX org_ai_access_grants_org_window_idx
  ON org_ai_access_grants(org_id, access_kind, ends_at)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE org_ai_access_grants IS
  'Platform-admin grant letting one team use a platform-owned AI path (free relay, sponsored pool, hosted keys) until ends_at. Absence of a row is not an error — the team simply falls back to its own keys.';

-- ---------------------------------------------------------------------------
-- Team join codes: opt-in self-signup that still lands the user in exactly ONE
-- known org. A code can never confer owner or admin — those stay invite-only.
CREATE TABLE org_join_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{6,12}$'),
  role org_role NOT NULL DEFAULT 'scout' CHECK (role IN ('scout','viewer')),
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX org_join_codes_org_idx ON org_join_codes(org_id) WHERE revoked_at IS NULL;

CREATE TABLE org_join_code_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  join_code_id uuid NOT NULL REFERENCES org_join_codes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (join_code_id, user_id)
);
CREATE INDEX org_join_code_redemptions_org_idx ON org_join_code_redemptions(org_id, redeemed_at DESC);

COMMENT ON TABLE org_join_codes IS
  'Owner/admin-issued self-signup code. Scoped to one org, capped by max_uses/expires_at, and structurally unable to grant owner or admin.';

-- ---------------------------------------------------------------------------
-- RLS
ALTER TABLE ai_credit_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_request_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_ai_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_join_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_join_code_redemptions ENABLE ROW LEVEL SECURITY;

-- Weights are public-read to signed-in users (a team should be able to see that an
-- agent run costs 4), platform-admin write.
CREATE POLICY ai_credit_weights_read ON ai_credit_weights FOR SELECT TO vantage_app
  USING (current_app_user_id() IS NOT NULL);
CREATE POLICY ai_credit_weights_admin ON ai_credit_weights FOR ALL TO vantage_app
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- A team sees its own ledger; only a platform admin may mint a grant; consumption is
-- written by the metering path under the worker role.
CREATE POLICY ai_request_credit_member_read ON ai_request_credit_ledger FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY ai_request_credit_platform_read ON ai_request_credit_ledger FOR SELECT TO vantage_app
  USING (is_platform_admin());
CREATE POLICY ai_request_credit_platform_grant ON ai_request_credit_ledger FOR INSERT TO vantage_app
  WITH CHECK (is_platform_admin() AND actor_user_id = current_app_user_id());
CREATE POLICY ai_request_credit_worker ON ai_request_credit_ledger FOR ALL TO vantage_worker
  USING (true) WITH CHECK (true);

CREATE POLICY org_ai_access_member_read ON org_ai_access_grants FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY org_ai_access_platform ON org_ai_access_grants FOR ALL TO vantage_app
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());
CREATE POLICY org_ai_access_worker_read ON org_ai_access_grants FOR SELECT TO vantage_worker
  USING (true);

-- Codes are owner/admin-managed. Members must not be able to read the raw code and
-- reshare it, so there is deliberately no member SELECT policy.
CREATE POLICY org_join_codes_admin ON org_join_codes FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY org_join_codes_platform_read ON org_join_codes FOR SELECT TO vantage_app
  USING (is_platform_admin());

CREATE POLICY org_join_redemptions_admin_read ON org_join_code_redemptions FOR SELECT TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY org_join_redemptions_self_read ON org_join_code_redemptions FOR SELECT TO vantage_app
  USING (user_id = current_app_user_id());

-- Table grants are the coarse gate; the policies above are the real boundary.
GRANT SELECT, UPDATE ON ai_credit_weights TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_credit_weights TO vantage_worker;
GRANT SELECT, INSERT ON ai_request_credit_ledger TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_request_credit_ledger TO vantage_worker;
GRANT SELECT ON org_ai_request_credits TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_ai_access_grants TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_join_codes TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_join_code_redemptions TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------------------
-- Redeeming a join code is the one place a non-member writes into memberships, so it
-- runs SECURITY DEFINER with every guard spelled out — same shape as
-- claim_frc_team_workspace in 0429.
CREATE OR REPLACE FUNCTION redeem_org_join_code(p_code text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  app_user users%ROWTYPE;
  code_row org_join_codes%ROWTYPE;
BEGIN
  SELECT * INTO app_user FROM users WHERE id = current_app_user_id();
  IF app_user.id IS NULL OR NOT app_user.email_verified THEN
    RAISE EXCEPTION 'A verified Vantage account is required to join a team';
  END IF;

  SELECT * INTO code_row FROM org_join_codes
   WHERE code = upper(trim(p_code))
   FOR UPDATE;

  IF code_row.id IS NULL THEN
    RAISE EXCEPTION 'That join code is not valid';
  END IF;
  IF code_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'That join code has been turned off';
  END IF;
  IF code_row.expires_at IS NOT NULL AND code_row.expires_at <= now() THEN
    RAISE EXCEPTION 'That join code has expired';
  END IF;
  IF code_row.max_uses IS NOT NULL AND code_row.uses >= code_row.max_uses THEN
    RAISE EXCEPTION 'That join code has already been used the maximum number of times';
  END IF;
  IF EXISTS (SELECT 1 FROM memberships WHERE org_id = code_row.org_id AND user_id = app_user.id) THEN
    RAISE EXCEPTION 'You are already a member of this team';
  END IF;

  INSERT INTO memberships(org_id, user_id, role) VALUES (code_row.org_id, app_user.id, code_row.role);
  UPDATE org_join_codes SET uses = uses + 1 WHERE id = code_row.id;
  INSERT INTO org_join_code_redemptions(org_id, join_code_id, user_id)
  VALUES (code_row.org_id, code_row.id, app_user.id);
  INSERT INTO membership_audit_events(org_id, actor_user_id, action, target_email_hash, metadata)
  VALUES (
    code_row.org_id,
    app_user.id,
    'membership.joined_via_code',
    encode(digest(lower(trim(app_user.email)), 'sha256'), 'hex'),
    jsonb_build_object('role', code_row.role, 'joinCodeId', code_row.id)
  );

  RETURN code_row.org_id;
END;
$$;

REVOKE ALL ON FUNCTION redeem_org_join_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_org_join_code(text) TO vantage_app;
