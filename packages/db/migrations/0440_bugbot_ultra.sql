-- Bugbot Ultra: hosted flat-fee scan / fix / recheck against connected GitHub repos.
-- Still stores hash + findings + truncated proposed diffs — never raw source dumps.

ALTER TABLE code_bugbot_reviews
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'subscription'
    CHECK (tier IN ('subscription', 'ultra')),
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'scan'
    CHECK (phase IN ('scan', 'fix', 'recheck')),
  ADD COLUMN IF NOT EXISTS github_repo text,
  ADD COLUMN IF NOT EXISTS github_ref text,
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES code_bugbot_reviews(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proposed_diff text,
  ADD COLUMN IF NOT EXISTS charge_usd numeric(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS files_scanned integer NOT NULL DEFAULT 1
    CHECK (files_scanned >= 0);

CREATE INDEX IF NOT EXISTS code_bugbot_reviews_org_tier_idx
  ON code_bugbot_reviews (org_id, tier, created_at DESC);

COMMENT ON COLUMN code_bugbot_reviews.tier IS
  'subscription = org BYOK / coding credits; ultra = hosted flat SKU ($1 scan, $2 fix, $1 recheck)';
