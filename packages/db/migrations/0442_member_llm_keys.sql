-- Personal AI keys (OpenAI / Anthropic / OpenAI-compatible) plus optional
-- OpenAI base URL override on team keys for Ollama / LM Studio.

ALTER TABLE org_llm_keys ADD COLUMN IF NOT EXISTS base_url text;
ALTER TABLE org_llm_keys ADD COLUMN IF NOT EXISTS model text;

CREATE TABLE IF NOT EXISTS member_llm_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  label text NOT NULL,
  key_ciphertext text NOT NULL,
  key_nonce text NOT NULL,
  key_auth_tag text NOT NULL,
  encrypted_dek text NOT NULL,
  kms_key_id text NOT NULL,
  base_url text,
  model text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, provider)
);

CREATE INDEX IF NOT EXISTS member_llm_keys_user_idx ON member_llm_keys (org_id, user_id);

ALTER TABLE member_llm_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_llm_keys_own ON member_llm_keys;
CREATE POLICY member_llm_keys_own ON member_llm_keys
  FOR ALL TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON member_llm_keys TO vantage_app, vantage_worker;
