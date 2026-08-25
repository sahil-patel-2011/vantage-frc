-- 0448: Prompt caching becomes default-ON for every org.
--
-- The caching machinery (Anthropic cache_control placement, OpenAI cached-token
-- parsing, cache-aware ledger pricing) has been wired since 0049, but the org
-- budget-policy column shipped DEFAULT false and dark — so in practice no org
-- ever cached and every repeated system prompt was billed at full input price.
--
-- The AI Budgets toggle (org_api_budget_policies.prompt_caching_enabled) remains
-- the single source of truth: any org can still turn caching off after this.
--
-- NOTE ON THE BACKFILL: the UPDATE below sets prompt_caching_enabled = true on
-- EVERY existing row, including any org that had explicitly disabled it. We are
-- deliberately overriding those rows. This is acceptable because the setting
-- shipped default-off and was never surfaced as an active choice — no org made
-- an informed decision to disable caching, the false values are all just the
-- old column default. Orgs that genuinely want it off can flip the toggle in
-- Team -> AI Budgets and their choice will stick from then on.

ALTER TABLE org_api_budget_policies
  ALTER COLUMN prompt_caching_enabled SET DEFAULT true;

UPDATE org_api_budget_policies
SET prompt_caching_enabled = true
WHERE prompt_caching_enabled = false;
