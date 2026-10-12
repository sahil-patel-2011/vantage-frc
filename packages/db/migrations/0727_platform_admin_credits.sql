-- Platform admin, rebuilt for its operator: who the platform admins are, AI credit the operator
-- gifts a team from their own provider keys, and the job signals the module-health page reads.
--
-- Everything here is a narrow SECURITY DEFINER function that checks the caller itself, the same
-- shape as 0720's team lifecycle: the request role (vantage_app, through withRls) cannot write
-- platform_admins, other people's inboxes or the audit, and must not see the operator's key
-- references. The routes check first and say why in plain words; these checks are the backstop.

-- ---------------------------------------------------------------------------------------------
-- 1. Platform admins
-- ---------------------------------------------------------------------------------------------

-- Who has Platform admin. platform_admins only lets each person read their own row, so the list
-- comes through here, for platform admins only.
CREATE FUNCTION platform_admin_list()
RETURNS TABLE (user_id uuid, email text, name text, granted_at timestamptz, granted_by_email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = '42501', DETAIL = 'vantage:not_platform_admin';
  END IF;
  RETURN QUERY
    SELECT p.user_id, u.email, COALESCE(NULLIF(btrim(pr.display_name), ''), NULLIF(btrim(u.name), ''), u.email),
           p.granted_at, g.email
      FROM platform_admins p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN profiles pr ON pr.user_id = p.user_id
      LEFT JOIN users g ON g.id = p.granted_by
     ORDER BY p.granted_at, u.email;
END $$;
REVOKE ALL ON FUNCTION platform_admin_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_list() TO vantage_app;

-- The account an email belongs to, for adding an admin. Deleted accounts carry an
-- @deleted.invalid address and so never match a real email.
CREATE FUNCTION platform_admin_target(p_email text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target uuid;
BEGIN
  SELECT id INTO target FROM users
   WHERE lower(email) = lower(btrim(COALESCE(p_email, '')))
     AND email NOT LIKE '%@deleted.invalid'
   LIMIT 1;
  IF target IS NULL THEN
    RAISE EXCEPTION 'No Vantage account uses that email' USING ERRCODE = 'P0002', DETAIL = 'vantage:no_account';
  END IF;
  RETURN target;
END $$;
REVOKE ALL ON FUNCTION platform_admin_target(text) FROM PUBLIC;

-- The note a new platform admin finds in their inbox.
CREATE FUNCTION platform_admin_welcome(p_target uuid, p_actor uuid, p_transfer boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  giver text;
BEGIN
  SELECT COALESCE(NULLIF(btrim(pr.display_name), ''), NULLIF(btrim(u.name), ''), u.email)
    INTO giver FROM users u LEFT JOIN profiles pr ON pr.user_id = u.id WHERE u.id = p_actor;
  INSERT INTO notifications(user_id, org_id, type, payload)
  VALUES (p_target, NULL, 'platform_admin_added', jsonb_build_object(
    'title', CASE WHEN p_transfer THEN 'You now run Vantage''s Platform admin' ELSE 'You are now a Vantage platform admin' END,
    'body', COALESCE(giver, 'A platform admin') ||
      CASE WHEN p_transfer THEN ' handed Platform admin to you. Teams, AI credit and module health are managed there.'
           ELSE ' gave you Platform admin. Teams, AI credit and module health are managed there.' END,
    'href', '/admin'));
END $$;
REVOKE ALL ON FUNCTION platform_admin_welcome(uuid, uuid, boolean) FROM PUBLIC;

-- Add a platform admin by the email of an existing account, from any team or none.
CREATE FUNCTION platform_admin_add(p_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  target uuid;
BEGIN
  IF actor IS NULL OR NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = '42501', DETAIL = 'vantage:not_platform_admin';
  END IF;
  -- One change to the admin list at a time, so two removals cannot both see "someone else is left".
  LOCK TABLE platform_admins IN SHARE ROW EXCLUSIVE MODE;
  target := platform_admin_target(p_email);
  IF EXISTS (SELECT 1 FROM platform_admins WHERE user_id = target) THEN
    RAISE EXCEPTION 'That person is already a platform admin' USING ERRCODE = '23505', DETAIL = 'vantage:already_admin';
  END IF;
  INSERT INTO platform_admins(user_id, granted_by) VALUES (target, actor);
  INSERT INTO admin_actions(actor_user_id, action, target_user_id, payload)
    VALUES (actor, 'platform_admin.added', target, jsonb_build_object('email', lower(btrim(p_email))));
  PERFORM platform_admin_welcome(target, actor, false);
  RETURN target;
END $$;
REVOKE ALL ON FUNCTION platform_admin_add(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_add(text) TO vantage_app;

-- Remove a platform admin. Never the last one: Vantage always needs someone who can provision a
-- team. That also covers "not yourself while you are the only one".
CREATE FUNCTION platform_admin_remove(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  target_email text;
BEGIN
  IF actor IS NULL OR NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = '42501', DETAIL = 'vantage:not_platform_admin';
  END IF;
  LOCK TABLE platform_admins IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = p_user) THEN
    RAISE EXCEPTION 'That person is not a platform admin' USING ERRCODE = 'P0002', DETAIL = 'vantage:not_admin';
  END IF;
  IF (SELECT count(*) FROM platform_admins) <= 1 THEN
    RAISE EXCEPTION 'Vantage needs at least one platform admin' USING ERRCODE = '42501', DETAIL = 'vantage:last_admin';
  END IF;
  SELECT email INTO target_email FROM users WHERE id = p_user;
  INSERT INTO admin_actions(actor_user_id, action, target_user_id, payload)
    VALUES (actor, 'platform_admin.removed', p_user,
            jsonb_build_object('email', target_email, 'self', p_user = actor));
  DELETE FROM platform_admins WHERE user_id = p_user;
  IF p_user <> actor THEN
    INSERT INTO notifications(user_id, org_id, type, payload)
    VALUES (p_user, NULL, 'platform_admin_removed', jsonb_build_object(
      'title', 'Your Platform admin access ended',
      'body', 'Another platform admin removed it. Your teams and account are unchanged.',
      'href', '/'));
  END IF;
END $$;
REVOKE ALL ON FUNCTION platform_admin_remove(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_remove(uuid) TO vantage_app;

-- Hand Platform admin to someone else in one step: they are added and you are removed together,
-- so there is never a moment with nobody (or with both, if the second half failed).
CREATE FUNCTION platform_admin_transfer(p_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  target uuid;
BEGIN
  IF actor IS NULL OR NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = '42501', DETAIL = 'vantage:not_platform_admin';
  END IF;
  LOCK TABLE platform_admins IN SHARE ROW EXCLUSIVE MODE;
  target := platform_admin_target(p_email);
  IF target = actor THEN
    RAISE EXCEPTION 'Choose someone other than yourself' USING ERRCODE = '22023', DETAIL = 'vantage:self';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = target) THEN
    INSERT INTO platform_admins(user_id, granted_by) VALUES (target, actor);
  END IF;
  INSERT INTO admin_actions(actor_user_id, action, target_user_id, payload)
    VALUES (actor, 'platform_admin.transferred', target,
            jsonb_build_object('email', lower(btrim(p_email)), 'from', actor));
  DELETE FROM platform_admins WHERE user_id = actor;
  PERFORM platform_admin_welcome(target, actor, true);
  RETURN target;
END $$;
REVOKE ALL ON FUNCTION platform_admin_transfer(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_transfer(text) TO vantage_app;

-- ---------------------------------------------------------------------------------------------
-- 2. AI credit gifts
-- ---------------------------------------------------------------------------------------------
--
-- A platform admin gives a team a dollar amount of AI on a model family (Claude, OpenAI, Gemini),
-- paid from the operator's own key pool for that provider (section 2a). No key is ever stored
-- here in plain text, and no key ever reaches a browser.
--
-- The cap is enforced from the gift's own ledger, never a counter: spent = settled costs plus
-- open holds. Before each provider call the runtime reserves the call's worst-case cost
-- (reserve_ai_credit_gift) in its own short committed transaction that holds the gift row
-- lock, so concurrent calls are serialized and a call that could cross the cap is refused.
-- After the call the hold is settled at the real cost, or released when the provider refused
-- it. Spend therefore never exceeds the gift.

-- Usage rows paid from a gift. Added alone: a new enum value is usable once this commits.
ALTER TYPE key_source ADD VALUE IF NOT EXISTS 'gift';

-- 2a. The operator's key pool. platform_provider_keys (0006, Model control) held one encrypted
-- key per row; it now holds any number per provider, each with a label, an order (priority,
-- lowest first) and an on/off switch (disabled_at, as before). A row is either an encrypted key
-- (the envelope columns) or a reference by name to a provider-key environment variable on the
-- deployment (key_env), never both. Routing tries a provider's keys in order and moves to the
-- next on a rate limit, a provider error or a rejected key; the failing key is marked degraded
-- with a reason (never the secret) for module health.
ALTER TABLE platform_provider_keys
  ADD COLUMN priority integer NOT NULL DEFAULT 100,
  ADD COLUMN key_env text,
  ADD COLUMN degraded_at timestamptz,
  ADD COLUMN degraded_reason text;
ALTER TABLE platform_provider_keys
  ALTER COLUMN key_ciphertext DROP NOT NULL,
  ALTER COLUMN key_nonce DROP NOT NULL,
  ALTER COLUMN key_auth_tag DROP NOT NULL,
  ALTER COLUMN encrypted_dek DROP NOT NULL,
  ALTER COLUMN kms_key_id DROP NOT NULL;
ALTER TABLE platform_provider_keys
  -- Only provider-key names: a pool row can never point the runtime at another secret.
  ADD CONSTRAINT platform_provider_keys_env_name CHECK (key_env IS NULL OR key_env ~
    '^(ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_AI_API_KEY|GEMINI_API_KEY|VANTAGE_GIFT_(ANTHROPIC|OPENAI|GOOGLE)_[A-Z0-9_]{1,40})$'),
  ADD CONSTRAINT platform_provider_keys_one_source CHECK (
    (key_env IS NOT NULL AND key_ciphertext IS NULL)
    OR (key_env IS NULL AND key_ciphertext IS NOT NULL AND key_nonce IS NOT NULL AND key_auth_tag IS NOT NULL
        AND encrypted_dek IS NOT NULL AND kms_key_id IS NOT NULL)),
  ADD CONSTRAINT platform_provider_keys_reason_length CHECK (degraded_reason IS NULL OR char_length(degraded_reason) <= 300);
CREATE INDEX platform_provider_keys_order_idx ON platform_provider_keys(provider, priority, created_at)
  WHERE disabled_at IS NULL;

-- The paid-tier managed peek (0096) only ever wanted an encrypted key: an env reference has no
-- ciphertext to decrypt. Same signature; it now follows the pool order too.
CREATE OR REPLACE FUNCTION peek_managed_chat_provider(p_org_id uuid)
RETURNS TABLE (
  provider text,
  model text,
  key_ciphertext text,
  key_nonce text,
  key_auth_tag text,
  encrypted_dek text,
  kms_key_id text,
  key_id uuid,
  input_price_per_million_usd numeric,
  output_price_per_million_usd numeric,
  cache_read_price_per_million_usd numeric,
  cache_write_price_per_million_usd numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_org_member(p_org_id) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org_billing b
    WHERE b.org_id = p_org_id AND b.tier IS DISTINCT FROM 'free'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    k.provider,
    m.provider_model_id AS model,
    k.key_ciphertext,
    k.key_nonce,
    k.key_auth_tag,
    k.encrypted_dek,
    k.kms_key_id,
    k.id AS key_id,
    m.input_price_per_million_usd,
    m.output_price_per_million_usd,
    m.cache_read_price_per_million_usd,
    m.cache_write_price_per_million_usd
  FROM platform_provider_keys k
  JOIN LATERAL (
    SELECT
      c.provider_model_id,
      c.input_price_per_million_usd,
      c.output_price_per_million_usd,
      c.cache_read_price_per_million_usd,
      c.cache_write_price_per_million_usd,
      c.routing_weight
    FROM model_catalog c
    WHERE c.enabled = true
      AND c.provider_model_id IS NOT NULL
      AND c.provider = k.provider
      AND COALESCE(c.funding_mode, 'managed_paid') = 'managed_paid'
      AND c.provider IN ('openai', 'anthropic')
    ORDER BY
      CASE WHEN 'chat' = ANY (c.capabilities) THEN 0 ELSE 1 END,
      c.routing_weight DESC,
      c.updated_at DESC
    LIMIT 1
  ) m ON true
  WHERE k.disabled_at IS NULL
    AND k.key_ciphertext IS NOT NULL
    AND k.provider IN ('openai', 'anthropic')
  ORDER BY k.priority, k.created_at
  LIMIT 1;
END;
$$;

-- The provider a gift family is paid by.
CREATE FUNCTION ai_credit_family_provider(p_family text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_family WHEN 'claude' THEN 'anthropic' WHEN 'gemini' THEN 'google' ELSE p_family END
$$;

CREATE TABLE ai_credit_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  family text NOT NULL CHECK (family IN ('claude', 'openai', 'gemini')),
  amount_usd numeric(12,6) NOT NULL CHECK (amount_usd > 0 AND amount_usd <= 1000),
  note text CHECK (note IS NULL OR char_length(note) <= 280),
  expires_at timestamptz,
  granted_by uuid NOT NULL REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  -- When the team was told; alert state, not a balance.
  alerted_80_at timestamptz,
  alerted_exhausted_at timestamptz,
  CHECK (expires_at IS NULL OR expires_at > granted_at)
);
CREATE INDEX ai_credit_gifts_org_idx ON ai_credit_gifts(org_id, granted_at DESC);

CREATE TABLE ai_credit_gift_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_id uuid NOT NULL REFERENCES ai_credit_gifts(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- held: reserved before the call · settled: the call's real cost · released: the provider
  -- refused the call, nothing spent · refused: Vantage refused it at the cap.
  state text NOT NULL CHECK (state IN ('held', 'settled', 'released', 'refused')),
  model text CHECK (model IS NULL OR char_length(model) <= 120),
  feature text CHECK (feature IS NULL OR char_length(feature) <= 120),
  reserved_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  cost_usd numeric(12,6) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  prompt_tokens integer CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  completion_tokens integer CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  -- Which pool key answered (by id and label; never the secret). Spend is counted per gift
  -- whichever key served it.
  key_id uuid REFERENCES platform_provider_keys(id) ON DELETE SET NULL,
  key_label text CHECK (key_label IS NULL OR char_length(key_label) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX ai_credit_gift_ledger_gift_idx ON ai_credit_gift_ledger(gift_id, state);
CREATE INDEX ai_credit_gift_ledger_org_idx ON ai_credit_gift_ledger(org_id, created_at DESC);
CREATE INDEX ai_credit_gift_ledger_key_idx ON ai_credit_gift_ledger(key_id) WHERE key_id IS NOT NULL;

ALTER TABLE ai_credit_gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_gift_ledger ENABLE ROW LEVEL SECURITY;
-- Gift rows are the operator's records: platform admins read them. A team reads its own gifts
-- through ai_credit_gift_summary().
CREATE POLICY ai_credit_gifts_platform_read ON ai_credit_gifts FOR SELECT TO vantage_app
  USING (is_platform_admin());
CREATE POLICY ai_credit_gifts_worker ON ai_credit_gifts TO vantage_worker USING (true) WITH CHECK (true);
-- The ledger holds no key material (a pool key's id and label at most): the team sees its own
-- spend by model. The team-facing route reads neither key column.
CREATE POLICY ai_credit_gift_ledger_read ON ai_credit_gift_ledger FOR SELECT TO vantage_app
  USING (is_org_member(org_id) OR is_platform_admin());
CREATE POLICY ai_credit_gift_ledger_worker ON ai_credit_gift_ledger TO vantage_worker USING (true) WITH CHECK (true);
-- Writes happen only through the functions below.
GRANT SELECT ON ai_credit_gifts, ai_credit_gift_ledger TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_credit_gifts, ai_credit_gift_ledger TO vantage_worker;

-- What a gift has used: real costs of settled calls plus the reservations still open.
CREATE FUNCTION ai_credit_gift_spent(p_gift uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(CASE state WHEN 'settled' THEN COALESCE(cost_usd, 0)
                                 WHEN 'held' THEN reserved_usd ELSE 0 END), 0)
    FROM ai_credit_gift_ledger WHERE gift_id = p_gift
$$;
REVOKE ALL ON FUNCTION ai_credit_gift_spent(uuid) FROM PUBLIC;

-- What a gift has actually cost so far: settled calls only. Alerts and the "used" figure in them
-- read this, so a reservation that is later released never tells a team it is nearly out.
CREATE FUNCTION ai_credit_gift_settled(p_gift uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(cost_usd), 0) FROM ai_credit_gift_ledger WHERE gift_id = p_gift AND state = 'settled'
$$;
REVOKE ALL ON FUNCTION ai_credit_gift_settled(uuid) FROM PUBLIC;

CREATE FUNCTION ai_credit_family_label(p_family text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_family WHEN 'claude' THEN 'Claude Sonnet 5.5 and Opus 5.5'
                       WHEN 'openai' THEN 'OpenAI GPT-4.1'
                       WHEN 'gemini' THEN 'Google Gemini'
                       ELSE p_family END
$$;

CREATE FUNCTION ai_credit_money(p_amount numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT '$' || to_char(round(COALESCE(p_amount, 0), 2), 'FM999990.00')
$$;

-- Tell a team's owners and admins about their gift. 'granted', '80', 'exhausted' or 'revoked'.
CREATE FUNCTION ai_credit_gift_notify(p_gift uuid, p_kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g ai_credit_gifts%ROWTYPE;
  spent numeric;
  title text;
  body text;
BEGIN
  SELECT * INTO g FROM ai_credit_gifts WHERE id = p_gift;
  IF g.id IS NULL THEN RETURN; END IF;
  spent := LEAST(ai_credit_gift_settled(g.id), g.amount_usd);
  IF p_kind = 'granted' THEN
    title := 'Vantage gave your team ' || ai_credit_money(g.amount_usd) || ' of AI credit';
    body := 'Ask AI can use ' || ai_credit_family_label(g.family) || ' until it is used up' ||
            CASE WHEN g.expires_at IS NULL THEN '' ELSE ' or until ' || to_char(g.expires_at AT TIME ZONE 'UTC', 'FMMonth FMDD, YYYY') END ||
            '. It stops at ' || ai_credit_money(g.amount_usd) || ', so there is never a bill.' ||
            CASE WHEN g.note IS NULL OR btrim(g.note) = '' THEN '' ELSE ' Note from Vantage: ' || btrim(g.note) END;
  ELSIF p_kind = '80' THEN
    title := '80% of your free AI credit is used';
    body := ai_credit_money(spent) || ' of ' || ai_credit_money(g.amount_usd) ||
            ' used. Ask AI stops when it runs out; add your own AI key to keep going after that.';
  ELSIF p_kind = 'exhausted' THEN
    title := 'Your free AI credit from Vantage is used up';
    body := ai_credit_money(spent) || ' of ' || ai_credit_money(g.amount_usd) ||
            ' used. Add your own AI key in AI settings to keep using Ask AI.';
  ELSIF p_kind = 'revoked' THEN
    title := 'Your free AI credit from Vantage has ended';
    body := 'Ask AI now uses your team''s own keys, if you have added any.';
  ELSE
    RETURN;
  END IF;
  INSERT INTO notifications(user_id, org_id, type, payload)
  SELECT m.user_id, g.org_id, 'ai_credit_gift', jsonb_build_object(
      'title', title, 'body', body, 'href', '/team/ai-keys', 'giftId', g.id, 'kind', p_kind)
    FROM memberships m
   WHERE m.org_id = g.org_id AND m.role IN ('owner', 'admin');
END $$;
REVOKE ALL ON FUNCTION ai_credit_gift_notify(uuid, text) FROM PUBLIC;

-- A gift is used up when what is left could not pay for even a short reply.
CREATE FUNCTION ai_credit_gift_alert_due(p_gift uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g ai_credit_gifts%ROWTYPE;
  spent numeric;
BEGIN
  SELECT * INTO g FROM ai_credit_gifts WHERE id = p_gift;
  spent := ai_credit_gift_settled(p_gift);
  IF g.alerted_exhausted_at IS NULL AND g.amount_usd - spent < 0.05 THEN
    UPDATE ai_credit_gifts SET alerted_exhausted_at = now(), alerted_80_at = COALESCE(alerted_80_at, now())
     WHERE id = p_gift;
    PERFORM ai_credit_gift_notify(p_gift, 'exhausted');
    RETURN 'exhausted';
  END IF;
  IF g.alerted_80_at IS NULL AND spent >= 0.8 * g.amount_usd THEN
    UPDATE ai_credit_gifts SET alerted_80_at = now() WHERE id = p_gift;
    PERFORM ai_credit_gift_notify(p_gift, '80');
    RETURN '80';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION ai_credit_gift_alert_due(uuid) FROM PUBLIC;

-- Give a team AI credit. Platform admins only. It is paid from the operator's pool for the
-- family's provider, so the pool needs at least one key switched on.
CREATE FUNCTION grant_ai_credit_gift(
  p_org uuid, p_family text, p_amount numeric, p_expires timestamptz, p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  new_id uuid;
BEGIN
  IF actor IS NULL OR NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = '42501', DETAIL = 'vantage:not_platform_admin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org) THEN
    RAISE EXCEPTION 'Team not found' USING ERRCODE = 'P0002', DETAIL = 'vantage:not_found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM platform_provider_keys
     WHERE lower(provider) = ai_credit_family_provider(p_family) AND disabled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'No key in the pool can pay for this' USING ERRCODE = 'P0002', DETAIL = 'vantage:key_missing';
  END IF;
  INSERT INTO ai_credit_gifts(org_id, family, amount_usd, note, expires_at, granted_by)
  VALUES (p_org, p_family, round(p_amount, 6), NULLIF(btrim(COALESCE(p_note, '')), ''), p_expires, actor)
  RETURNING id INTO new_id;
  INSERT INTO admin_actions(actor_user_id, action, target_org_id, payload)
    VALUES (actor, 'ai_credit.gifted', p_org, jsonb_build_object(
      'giftId', new_id, 'family', p_family, 'amountUsd', round(p_amount, 6), 'expiresAt', p_expires));
  PERFORM ai_credit_gift_notify(new_id, 'granted');
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION grant_ai_credit_gift(uuid, text, numeric, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grant_ai_credit_gift(uuid, text, numeric, timestamptz, text) TO vantage_app;

-- End a gift early. What was spent stays on the ledger.
CREATE FUNCTION revoke_ai_credit_gift(p_gift uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  g ai_credit_gifts%ROWTYPE;
BEGIN
  IF actor IS NULL OR NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = '42501', DETAIL = 'vantage:not_platform_admin';
  END IF;
  SELECT * INTO g FROM ai_credit_gifts WHERE id = p_gift FOR UPDATE;
  IF g.id IS NULL THEN
    RAISE EXCEPTION 'Gift not found' USING ERRCODE = 'P0002', DETAIL = 'vantage:not_found';
  END IF;
  IF g.revoked_at IS NOT NULL THEN RETURN; END IF;
  UPDATE ai_credit_gifts SET revoked_at = now(), revoked_by = actor WHERE id = p_gift;
  INSERT INTO admin_actions(actor_user_id, action, target_org_id, payload)
    VALUES (actor, 'ai_credit.revoked', g.org_id, jsonb_build_object(
      'giftId', g.id, 'amountUsd', g.amount_usd, 'spentUsd', ai_credit_gift_spent(g.id)));
  PERFORM ai_credit_gift_notify(p_gift, 'revoked');
END $$;
REVOKE ALL ON FUNCTION revoke_ai_credit_gift(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_ai_credit_gift(uuid) TO vantage_app;

-- The gift Ask AI should draw on for this team right now. Members only. A usable gift (more than
-- a short reply's worth left) comes first; an exhausted one is still returned so the refusal can
-- say the credit is used up.
CREATE FUNCTION ai_credit_gift_for_org(p_org uuid)
RETURNS TABLE (gift_id uuid, family text, amount_usd numeric, spent_usd numeric, expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_org_member(p_org) THEN RETURN; END IF;
  RETURN QUERY
    SELECT g.id, g.family, g.amount_usd, s.spent, g.expires_at
      FROM ai_credit_gifts g
      CROSS JOIN LATERAL (SELECT ai_credit_gift_spent(g.id) AS spent) s
     WHERE g.org_id = p_org AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
     ORDER BY (g.amount_usd - s.spent >= 0.05) DESC, g.expires_at ASC NULLS LAST, g.granted_at
     LIMIT 1;
END $$;
REVOKE ALL ON FUNCTION ai_credit_gift_for_org(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_credit_gift_for_org(uuid) TO vantage_app;

-- The pool keys that pay for one active gift, in order, switched-on only. For a member of the
-- gift's team, server-side: an env row returns its variable's name and an encrypted row its
-- envelope, which the server decrypts (createKms) the same as peek_managed_chat_provider.
CREATE FUNCTION ai_credit_gift_keys(p_gift uuid)
RETURNS TABLE (key_id uuid, label text, key_env text, key_ciphertext text, key_nonce text,
               key_auth_tag text, encrypted_dek text, kms_key_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g ai_credit_gifts%ROWTYPE;
BEGIN
  SELECT * INTO g FROM ai_credit_gifts WHERE id = p_gift;
  IF g.id IS NULL OR NOT is_org_member(g.org_id) OR g.revoked_at IS NOT NULL
     OR (g.expires_at IS NOT NULL AND g.expires_at <= now()) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT k.id, k.label, k.key_env, k.key_ciphertext, k.key_nonce, k.key_auth_tag, k.encrypted_dek, k.kms_key_id
      FROM platform_provider_keys k
     WHERE lower(k.provider) = ai_credit_family_provider(g.family) AND k.disabled_at IS NULL
     ORDER BY k.priority, k.created_at;
END $$;
REVOKE ALL ON FUNCTION ai_credit_gift_keys(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_credit_gift_keys(uuid) TO vantage_app;

-- A pool key turned a gift's call away (rate limit, provider error, rejected key): mark it
-- degraded for module health. Only a member of a team with an active gift on that provider may
-- report it, and only a reason the runtime wrote (never the key). A degraded key keeps its
-- place in the order: the mark informs the operator, it does not take a key out of rotation.
CREATE FUNCTION note_platform_key_failure(p_gift uuid, p_key uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g ai_credit_gifts%ROWTYPE;
BEGIN
  SELECT * INTO g FROM ai_credit_gifts WHERE id = p_gift;
  IF g.id IS NULL OR NOT is_org_member(g.org_id) OR g.revoked_at IS NOT NULL THEN RETURN; END IF;
  UPDATE platform_provider_keys
     SET degraded_at = now(), degraded_reason = left(COALESCE(NULLIF(btrim(p_reason), ''), 'Request failed'), 300)
   WHERE id = p_key AND lower(provider) = ai_credit_family_provider(g.family);
END $$;
REVOKE ALL ON FUNCTION note_platform_key_failure(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION note_platform_key_failure(uuid, uuid, text) TO vantage_app;

-- What a team sees about its gifts: amounts, spend, dates and the note. Never the key.
CREATE FUNCTION ai_credit_gift_summary(p_org uuid)
RETURNS TABLE (
  gift_id uuid, family text, amount_usd numeric, spent_usd numeric, expires_at timestamptz,
  granted_at timestamptz, note text, active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_org_member(p_org) THEN RETURN; END IF;
  RETURN QUERY
    SELECT g.id, g.family, g.amount_usd, ai_credit_gift_spent(g.id), g.expires_at, g.granted_at, g.note,
           g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
      FROM ai_credit_gifts g
     WHERE g.org_id = p_org AND g.revoked_at IS NULL
     ORDER BY g.granted_at DESC
     LIMIT 10;
END $$;
REVOKE ALL ON FUNCTION ai_credit_gift_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_credit_gift_summary(uuid) TO vantage_app;

-- Reserve a call's worst-case cost before it runs. The gift row lock serializes reservations for
-- one gift, and the runtime calls this in its own short transaction (committed before the
-- provider call), so a concurrent call always sees this hold. Returns the hold, or why not.
CREATE FUNCTION reserve_ai_credit_gift(p_gift uuid, p_amount numeric, p_model text, p_feature text)
RETURNS TABLE (hold_id uuid, outcome text, amount_usd numeric, spent_usd numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := current_app_user_id();
  g ai_credit_gifts%ROWTYPE;
  spent numeric;
  new_id uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501'; END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'A reservation needs an amount' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO g FROM ai_credit_gifts WHERE id = p_gift FOR UPDATE;
  IF g.id IS NULL OR NOT is_org_member(g.org_id) THEN
    RAISE EXCEPTION 'Gift not found' USING ERRCODE = 'P0002', DETAIL = 'vantage:not_found';
  END IF;
  spent := ai_credit_gift_spent(g.id);
  IF g.revoked_at IS NOT NULL OR (g.expires_at IS NOT NULL AND g.expires_at <= now()) THEN
    RETURN QUERY SELECT NULL::uuid, 'inactive'::text, g.amount_usd, spent;
    RETURN;
  END IF;
  IF spent + round(p_amount, 6) > g.amount_usd THEN
    INSERT INTO ai_credit_gift_ledger(gift_id, org_id, user_id, state, model, feature, reserved_usd, settled_at)
      VALUES (g.id, g.org_id, actor, 'refused', left(p_model, 120), left(p_feature, 120), round(p_amount, 6), now());
    PERFORM ai_credit_gift_alert_due(g.id);
    RETURN QUERY SELECT NULL::uuid, 'refused'::text, g.amount_usd, spent;
    RETURN;
  END IF;
  INSERT INTO ai_credit_gift_ledger(gift_id, org_id, user_id, state, model, feature, reserved_usd)
    VALUES (g.id, g.org_id, actor, 'held', left(p_model, 120), left(p_feature, 120), round(p_amount, 6))
    RETURNING id INTO new_id;
  RETURN QUERY SELECT new_id, 'held'::text, g.amount_usd, spent + round(p_amount, 6);
END $$;
REVOKE ALL ON FUNCTION reserve_ai_credit_gift(uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_ai_credit_gift(uuid, numeric, text, text) TO vantage_app;

-- Settle a hold at the call's real cost (or release it at zero when the provider refused the
-- call), recording which pool key answered. A key that answered is healthy again. Returns the
-- alert that fired, if any: '80' or 'exhausted', for the email follow-up.
CREATE FUNCTION settle_ai_credit_gift(
  p_hold uuid, p_cost numeric, p_prompt integer, p_completion integer, p_released boolean, p_key uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hold ai_credit_gift_ledger%ROWTYPE;
  served_label text;
BEGIN
  IF current_app_user_id() IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501'; END IF;
  SELECT * INTO hold FROM ai_credit_gift_ledger WHERE id = p_hold;
  IF hold.id IS NULL OR NOT is_org_member(hold.org_id) THEN
    RAISE EXCEPTION 'Hold not found' USING ERRCODE = 'P0002', DETAIL = 'vantage:not_found';
  END IF;
  PERFORM 1 FROM ai_credit_gifts WHERE id = hold.gift_id FOR UPDATE;
  IF hold.state <> 'held' THEN RETURN NULL; END IF;
  IF p_key IS NOT NULL THEN
    SELECT label INTO served_label FROM platform_provider_keys WHERE id = p_key;
  END IF;
  UPDATE ai_credit_gift_ledger
     SET state = CASE WHEN p_released THEN 'released' ELSE 'settled' END,
         cost_usd = CASE WHEN p_released THEN 0 ELSE round(GREATEST(COALESCE(p_cost, 0), 0), 6) END,
         prompt_tokens = GREATEST(COALESCE(p_prompt, 0), 0),
         completion_tokens = GREATEST(COALESCE(p_completion, 0), 0),
         key_id = CASE WHEN served_label IS NULL THEN NULL ELSE p_key END,
         key_label = left(served_label, 120),
         settled_at = now()
   WHERE id = p_hold;
  IF p_released THEN RETURN NULL; END IF;
  IF served_label IS NOT NULL THEN
    UPDATE platform_provider_keys SET last_used_at = now(), degraded_at = NULL, degraded_reason = NULL
     WHERE id = p_key;
  END IF;
  RETURN ai_credit_gift_alert_due(hold.gift_id);
END $$;
REVOKE ALL ON FUNCTION settle_ai_credit_gift(uuid, numeric, integer, integer, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION settle_ai_credit_gift(uuid, numeric, integer, integer, boolean, uuid) TO vantage_app;

-- ---------------------------------------------------------------------------------------------
-- 2b. More than one key per provider for teams and members
-- ---------------------------------------------------------------------------------------------
--
-- org_llm_keys never had a unique provider, but the API replaced the key on every save, and
-- member_llm_keys allowed one per member per provider (0496). Both now keep any number, each
-- with its label (already there), an order and an on/off switch, and the same failover as the
-- operator's pool. Existing rows keep working: they are switched on at the default order.
ALTER TABLE org_llm_keys
  ADD COLUMN priority integer NOT NULL DEFAULT 100,
  ADD COLUMN enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN last_error_at timestamptz,
  ADD COLUMN last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 200);
ALTER TABLE member_llm_keys
  ADD COLUMN priority integer NOT NULL DEFAULT 100,
  ADD COLUMN enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN last_error_at timestamptz,
  ADD COLUMN last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 200);
ALTER TABLE member_llm_keys DROP CONSTRAINT IF EXISTS member_llm_keys_org_id_user_id_provider_key;
CREATE INDEX org_llm_keys_order_idx ON org_llm_keys(org_id, provider, priority, created_at);
CREATE INDEX member_llm_keys_order_idx ON member_llm_keys(org_id, user_id, provider, priority, created_at);

-- What happened when a team or member key was tried: it answered (last used) or the provider
-- turned it away (the reason, never the key). Whoever's turn it was may record it, which the
-- request role cannot do on a team key unless it is an owner or admin.
CREATE FUNCTION note_llm_key_result(p_scope text, p_key uuid, p_ok boolean, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_app_user_id() IS NULL THEN RETURN; END IF;
  IF p_scope = 'org' THEN
    UPDATE org_llm_keys
       SET last_used_at = CASE WHEN p_ok THEN now() ELSE last_used_at END,
           last_error_at = CASE WHEN p_ok THEN NULL ELSE now() END,
           last_error = CASE WHEN p_ok THEN NULL ELSE left(COALESCE(NULLIF(btrim(p_reason), ''), 'Request failed'), 200) END
     WHERE id = p_key AND is_org_member(org_id);
  ELSIF p_scope = 'member' THEN
    UPDATE member_llm_keys
       SET last_used_at = CASE WHEN p_ok THEN now() ELSE last_used_at END,
           last_error_at = CASE WHEN p_ok THEN NULL ELSE now() END,
           last_error = CASE WHEN p_ok THEN NULL ELSE left(COALESCE(NULLIF(btrim(p_reason), ''), 'Request failed'), 200) END
     WHERE id = p_key AND user_id = current_app_user_id();
  END IF;
END $$;
REVOKE ALL ON FUNCTION note_llm_key_result(text, uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION note_llm_key_result(text, uuid, boolean, text) TO vantage_app;

-- ---------------------------------------------------------------------------------------------
-- 3. Job signals for module health (platform admins only)
-- ---------------------------------------------------------------------------------------------
--
-- The sync and job tables are team-scoped (or worker-only), so a platform admin cannot read them
-- through RLS. This returns one row per source: when it last worked, when it last failed, and its
-- most recent error lines (trimmed; the app redacts anything secret-shaped before showing them).
CREATE FUNCTION platform_job_health()
RETURNS TABLE (
  source text, last_success_at timestamptz, last_failure_at timestamptz,
  runs_24h integer, failures_24h integer, open_jobs integer, recent_errors jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = '42501', DETAIL = 'vantage:not_platform_admin';
  END IF;

  RETURN QUERY
  SELECT 'recovery_checkpoint'::text,
         max(c.verified_at),
         max(c.created_at) FILTER (WHERE c.state = 'failed'),
         (count(*) FILTER (WHERE c.created_at > now() - interval '24 hours'))::int,
         (count(*) FILTER (WHERE c.state = 'failed' AND c.created_at > now() - interval '24 hours'))::int,
         (count(*) FILTER (WHERE c.state = 'writing'))::int,
         COALESCE((SELECT jsonb_agg(e ORDER BY e->>'at' DESC) FROM (
            SELECT jsonb_build_object('at', r.created_at, 'message', left(r.error, 500), 'scope', r.kind) AS e
              FROM recovery_checkpoints r WHERE r.error IS NOT NULL ORDER BY r.created_at DESC LIMIT 10) x), '[]'::jsonb)
    FROM recovery_checkpoints c;

  RETURN QUERY
  SELECT 'spreadsheet_mirror'::text,
         max(w.finished_at) FILTER (WHERE w.status = 'succeeded'),
         max(COALESCE(w.finished_at, w.started_at)) FILTER (WHERE w.status IN ('failed', 'partial')),
         (count(*) FILTER (WHERE w.started_at > now() - interval '24 hours'))::int,
         (count(*) FILTER (WHERE w.status IN ('failed', 'partial') AND w.started_at > now() - interval '24 hours'))::int,
         (count(*) FILTER (WHERE w.status = 'running'))::int,
         COALESCE((SELECT jsonb_agg(e ORDER BY e->>'at' DESC) FROM (
            SELECT jsonb_build_object('at', COALESCE(r.finished_at, r.started_at), 'message', left(r.error, 500),
                                      'scope', r.target, 'team', o.team_number) AS e
              FROM workbook_sync_runs r LEFT JOIN organizations o ON o.id = r.org_id
             WHERE r.error IS NOT NULL ORDER BY r.started_at DESC LIMIT 10) x), '[]'::jsonb)
    FROM workbook_sync_runs w;

  RETURN QUERY
  SELECT 'readable_sync'::text,
         max(j.last_verified_at),
         max(j.updated_at) FILTER (WHERE j.state = 'failed'),
         (count(*) FILTER (WHERE j.updated_at > now() - interval '24 hours'))::int,
         (count(*) FILTER (WHERE j.state = 'failed' AND j.updated_at > now() - interval '24 hours'))::int,
         (count(*) FILTER (WHERE j.state IN ('queued', 'running', 'waiting')))::int,
         COALESCE((SELECT jsonb_agg(e ORDER BY e->>'at' DESC) FROM (
            SELECT jsonb_build_object('at', r.updated_at, 'message', left(r.error, 500), 'scope', r.state,
                                      'team', o.team_number) AS e
              FROM team_readable_sync_jobs r LEFT JOIN organizations o ON o.id = r.org_id
             WHERE r.error IS NOT NULL ORDER BY r.updated_at DESC LIMIT 10) x), '[]'::jsonb)
    FROM team_readable_sync_jobs j;

  RETURN QUERY
  SELECT 'team_provisioning'::text,
         max(p.verified_at),
         max(p.updated_at) FILTER (WHERE p.state = 'failed'),
         (count(*) FILTER (WHERE p.updated_at > now() - interval '24 hours'))::int,
         (count(*) FILTER (WHERE p.state = 'failed' AND p.updated_at > now() - interval '24 hours'))::int,
         (count(*) FILTER (WHERE p.state IN ('queued', 'running', 'waiting')))::int,
         COALESCE((SELECT jsonb_agg(e ORDER BY e->>'at' DESC) FROM (
            SELECT jsonb_build_object('at', r.updated_at, 'message', left(r.error, 500), 'scope', r.phase,
                                      'team', o.team_number) AS e
              FROM team_provisioning_jobs r LEFT JOIN organizations o ON o.id = r.org_id
             WHERE r.error IS NOT NULL ORDER BY r.updated_at DESC LIMIT 10) x), '[]'::jsonb)
    FROM team_provisioning_jobs p;

  RETURN QUERY
  SELECT 'export_jobs'::text,
         max(x.completed_at),
         max(x.updated_at) FILTER (WHERE x.status = 'failed'),
         (count(*) FILTER (WHERE x.created_at > now() - interval '24 hours'))::int,
         (count(*) FILTER (WHERE x.status = 'failed' AND x.updated_at > now() - interval '24 hours'))::int,
         (count(*) FILTER (WHERE x.status IN ('queued', 'running')))::int,
         COALESCE((SELECT jsonb_agg(e ORDER BY e->>'at' DESC) FROM (
            SELECT jsonb_build_object('at', r.updated_at, 'message', left(r.error, 500), 'scope', r.scope) AS e
              FROM export_jobs r WHERE r.error IS NOT NULL ORDER BY r.updated_at DESC LIMIT 10) y), '[]'::jsonb)
    FROM export_jobs x;
END $$;
REVOKE ALL ON FUNCTION platform_job_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_job_health() TO vantage_app;

SELECT install_view_only_guards();
