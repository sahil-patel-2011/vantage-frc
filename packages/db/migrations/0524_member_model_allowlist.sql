-- Per-member model allowlist on top of existing spend/token caps.
-- Empty array means no extra restriction (org policy still applies).

ALTER TABLE org_api_member_limits
  ADD COLUMN IF NOT EXISTS allowed_model_ids text[] NOT NULL DEFAULT '{}';

GRANT SELECT, INSERT, UPDATE, DELETE ON org_api_member_limits TO vantage_app, vantage_worker;
