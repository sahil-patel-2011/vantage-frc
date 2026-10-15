-- Per-key monthly spend limits for AI keys.
--
-- A member's personal key is their own money and a team key is the team's: each can carry its
-- own limit for the calendar month, or none (NULL = unlimited). The chat resolver skips a key
-- whose spend this month has reached its limit. Spend per key comes from ai_usage_events, whose
-- metadata already records the key that served each call (metadata.servedKey.id / .scope).

ALTER TABLE member_llm_keys
  ADD COLUMN IF NOT EXISTS monthly_spend_limit_usd numeric(12,6)
    CHECK (monthly_spend_limit_usd IS NULL OR monthly_spend_limit_usd >= 0);

ALTER TABLE org_llm_keys
  ADD COLUMN IF NOT EXISTS monthly_spend_limit_usd numeric(12,6)
    CHECK (monthly_spend_limit_usd IS NULL OR monthly_spend_limit_usd >= 0);

-- This month's spend for one key, read on every resolve that has a limited key and by the keys
-- page: by served key id, then time.
CREATE INDEX IF NOT EXISTS ai_usage_events_served_key_created_idx
  ON ai_usage_events ((metadata #>> '{servedKey,id}'), created_at)
  WHERE metadata ? 'servedKey';
