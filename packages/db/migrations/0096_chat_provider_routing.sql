-- Chat provider routing: org members need to read BYOK ciphertext for server-side
-- decrypt during /api/agent (never returned plaintext by list APIs). Managed keys
-- stay admin-only on the table; entitled members peek via SECURITY DEFINER.

CREATE POLICY keys_member_read ON org_llm_keys FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

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
    AND k.provider IN ('openai', 'anthropic')
  ORDER BY k.last_used_at DESC NULLS LAST, k.created_at DESC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION peek_managed_chat_provider(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION peek_managed_chat_provider(uuid) TO vantage_app, vantage_worker;
