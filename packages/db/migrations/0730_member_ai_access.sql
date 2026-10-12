-- Owners and admins can turn AI off for one person (Team -> AI limits -> One person), on top of
-- the team's pause switch and the per-person spend and token limits already on this row.
-- Checked on every metered AI call (packages/billing enforceApiBudgets), whichever key pays,
-- including personal keys that the token limits skip. Existing RLS and grants on the table
-- cover the new column.
ALTER TABLE org_api_member_limits
  ADD COLUMN IF NOT EXISTS ai_blocked boolean NOT NULL DEFAULT false;
