-- Mentors can turn team chat off for the whole org. Default stays on so
-- existing teams keep the channel they already use. DMs still follow dm_mode.
ALTER TABLE org_chat_policy
  ADD COLUMN IF NOT EXISTS team_chat_enabled boolean NOT NULL DEFAULT true;

GRANT SELECT, INSERT, UPDATE ON org_chat_policy TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_chat_policy TO vantage_worker;
