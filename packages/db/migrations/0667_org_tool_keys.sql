-- Keys a team brings for tools the AI agent calls — starting with TinyFish, which
-- gives the agent web search and page reading on the team's own free quota.
--
-- Deliberately NOT org_llm_keys. That table means "this team brought an AI
-- model key", and the platform reads it that way in two places that would
-- misfire on a tool key:
--
--   * packages/billing decides a team is "byo" if ANY org_llm_keys row exists,
--     and lets a free-tier team through the "must configure a BYO AI key" gate
--     on the same test. A team that added only a TinyFish key would pass both —
--     and then fail at call time with no model to run.
--   * resolve-chat-adapter's fallback walks org_llm_keys rows and tries each as
--     a chat provider.
--
-- So tool keys get their own table. Same envelope encryption (ciphertext,
-- nonce, auth tag, wrapped DEK, KMS key id) and the same access shape as
-- org_llm_keys after 0096: members may read the encrypted row so their own
-- agent request can decrypt it server-side, only members holding
-- manage_api_keys may write, and no API returns ciphertext or plaintext.

CREATE TABLE org_tool_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- One vocabulary, checked here so a typo in application code cannot create
  -- a key for a tool nothing reads.
  tool text NOT NULL CHECK (tool IN ('tinyfish')),
  key_ciphertext text NOT NULL,
  key_nonce text NOT NULL,
  key_auth_tag text NOT NULL,
  encrypted_dek text NOT NULL,
  kms_key_id text NOT NULL,
  -- Last four characters, so the settings page can say "a key ending in …ab12"
  -- without decrypting anything. Never longer: four characters of a 30+
  -- character key confirm which key it is and help nobody guess it.
  key_hint text NOT NULL DEFAULT '' CHECK (length(key_hint) <= 4),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  -- When TinyFish last accepted the key: set on save (the route verifies before
  -- storing) and on each successful call.
  verified_at timestamptz,
  last_used_at timestamptz,
  -- Why the most recent call failed, if it did. A key revoked on TinyFish's
  -- side should say so on the settings page — not leave the agent quietly
  -- answering without the web and nobody knowing why.
  last_error text CHECK (last_error IS NULL OR last_error IN ('invalid_key', 'rate_limited', 'unavailable', 'bad_request')),
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, tool)
);

CREATE INDEX org_tool_keys_org_idx ON org_tool_keys (org_id);

ALTER TABLE org_tool_keys ENABLE ROW LEVEL SECURITY;

-- Read: any member, because any member's agent run may need it. The list API
-- selects only the tool, hint and status columns.
CREATE POLICY tool_keys_member_read ON org_tool_keys FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- Write: the same capability that governs AI model keys.
CREATE POLICY tool_keys_manage ON org_tool_keys FOR ALL TO vantage_app
  USING (has_org_capability(org_id, 'manage_api_keys'::org_capability))
  WITH CHECK (has_org_capability(org_id, 'manage_api_keys'::org_capability));

-- Recording a call's outcome is not "managing the key", but it is a write, and
-- a student's agent run is what makes the call. This lets a member's request
-- update the health columns and nothing else — not the key, not the tool, not
-- who created it — and only for their own team.
CREATE OR REPLACE FUNCTION record_org_tool_key_outcome(
  p_org_id uuid,
  p_tool text,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_org_member(p_org_id) THEN
    RETURN;
  END IF;
  IF p_error IS NULL THEN
    UPDATE org_tool_keys
       SET last_used_at = now(),
           verified_at = now(),
           last_error = NULL,
           last_error_at = NULL
     WHERE org_id = p_org_id AND tool = p_tool;
  ELSIF p_error IN ('invalid_key', 'rate_limited', 'unavailable', 'bad_request') THEN
    UPDATE org_tool_keys
       SET last_error = p_error,
           last_error_at = now()
     WHERE org_id = p_org_id AND tool = p_tool;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION record_org_tool_key_outcome(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_org_tool_key_outcome(uuid, text, text) TO vantage_app, vantage_worker;

GRANT SELECT, INSERT, UPDATE, DELETE ON org_tool_keys TO vantage_app, vantage_worker;
