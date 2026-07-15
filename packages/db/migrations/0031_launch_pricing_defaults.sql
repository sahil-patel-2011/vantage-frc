-- Launch commercial model: no API markup (1.0×), USD included allowances, Access + PAYG path, week team trial.
-- Catalog stays admin-configurable; this migration only ships launch defaults and a new entitlement version.

ALTER TABLE plan_entitlement_versions ALTER COLUMN service_multiplier SET DEFAULT 1.0;
ALTER TABLE platform_margin_config ALTER COLUMN service_multiplier SET DEFAULT 1.0;
ALTER TABLE credit_ledger ALTER COLUMN service_multiplier SET DEFAULT 1.0;

UPDATE platform_margin_config
SET service_multiplier = 1.0, updated_at = now()
WHERE id = 'default';

-- Pass-through economics: when multiplier is 1.0, subscription covers platform overhead — not gross API fill.
CREATE OR REPLACE FUNCTION validate_plan_margin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  price numeric;
  fees numeric;
  infra numeric;
  reserve numeric;
  worst_provider numeric;
  included numeric;
BEGIN
  SELECT monthly_price_usd INTO price FROM pricing_plans WHERE code = NEW.plan_code;
  SELECT
    price * stripe_fee_percent / 100 + stripe_fixed_fee_usd,
    infrastructure_allocation_usd,
    price * support_reserve_percent / 100
  INTO fees, infra, reserve
  FROM platform_margin_config
  WHERE id = 'default';

  IF COALESCE((NEW.fair_use->>'confirmStructuralLoss')::boolean, false) THEN
    RETURN NEW;
  END IF;

  -- Pass-through (no model-spend markup): require subscription to cover fees + infra + reserve only.
  IF NEW.service_multiplier <= 1.001 THEN
    IF price > 0 AND fees + infra + reserve > price THEN
      RAISE EXCEPTION 'Plan subscription cannot cover platform fees/infra/reserve; explicit confirmation is required';
    END IF;
    RETURN NEW;
  END IF;

  included := GREATEST(COALESCE(NEW.included_credits, 0), COALESCE(NEW.managed_allowance_usd, 0));
  worst_provider := included / NEW.service_multiplier;
  IF price > 0 AND worst_provider + fees + infra + reserve > price THEN
    RAISE EXCEPTION 'Plan configuration is structurally loss-making; explicit confirmation is required';
  END IF;
  RETURN NEW;
END $$;

INSERT INTO pricing_plans(code, name, monthly_price_usd, included_allowance_usd, features, active) VALUES
('free', 'Free', 0, 0,
 '["Complete non-AI competition core","BYOK or local OpenAI-compatible relay","No managed API allowance","Managed routing stronger via integrated tools/context — not BYOK sabotage"]', true),
('access', 'Access', 20, 0,
 '["$20/mo light access","Unlocks Vantage managed routing at provider list rates","No large included API bucket — use Usage Credits or PAYG","Clarify vs Free BYOK"]', true),
('individual_pro', 'Individual Pro', 30, 27,
 '["Private only","$27 included managed API allowance then hard cut-off","Priority access to new features","Usage Credit = $1 provider API at list rates"]', true),
('individual_max', 'Individual Max', 50, 45,
 '["Private only","$45 included managed API allowance then hard cut-off","~2× Individual Pro rate/concurrency limits","Priority access to new features"]', true),
('team_pro', 'Team Pro', 100, 90,
 '["Organization-wide","$90 pooled managed API allowance then hard cut-off","Shared AI and automations","Org budget/member/feature controls"]', true),
('team_max', 'Team Max', 200, 185,
 '["Organization-wide","$185 pooled managed API allowance then hard cut-off","~2× Team Pro rate limits","Advanced CAD, strategy, code, and admin"]', true),
('team_trial', 'Week Team Trial', 0, 20,
 '["7-day admin-granted team trial","$20 included managed API allowance","No surprise auto-charge unless they subscribe"]', false)
ON CONFLICT(code) DO UPDATE SET
  name = excluded.name,
  monthly_price_usd = excluded.monthly_price_usd,
  included_allowance_usd = excluded.included_allowance_usd,
  features = excluded.features,
  active = excluded.active,
  updated_at = now();

-- Keep legacy showcase plans inactive (admin may still reference historical periods).
UPDATE pricing_plans SET active = false, updated_at = now()
WHERE code IN ('managed_20', 'managed_50');

INSERT INTO plan_entitlement_versions(
  plan_code, version, effective_at, managed_allowance_usd, billing_owner_type, included_credits,
  service_multiplier, fair_use, context_token_limit, agent_step_limit, cad_iteration_limit,
  cad_concurrent_jobs, code_analysis_mb, job_priority, feature_flags, change_notice
) VALUES
('free', 2, '2026-07-15', 0, 'org', 0, 1.0,
 '{"maxConcurrentPrivateJobs":1}',
 4000, 6, 3, 1, 5, 0,
 '{"private_managed_ai":false,"team_automations":false,"advanced_strategy":false,"cad_design_review":false,"priority_features":false}',
 'Launch Free: BYOK/local OK; $0 managed allowance.'),
('access', 1, '2026-07-15', 0, 'user', 0, 1.0,
 '{"maxConcurrentPrivateJobs":2}',
 16000, 24, 20, 2, 50, 8,
 '{"private_managed_ai":true,"team_automations":false,"advanced_strategy":true,"cad_design_review":true,"priority_features":false,"payg_managed_routing":true}',
 'Access unlocks managed routing at list rates without a large included bucket.'),
('individual_pro', 2, '2026-07-15', 27, 'user', 27, 1.0,
 '{"maxConcurrentPrivateJobs":2,"maxHourlyJobs":60}',
 16000, 24, 20, 2, 50, 10,
 '{"private_managed_ai":true,"team_automations":false,"advanced_strategy":true,"cad_design_review":true,"priority_features":true}',
 'Launch Individual Pro: $27 API hard cut-off; 1.0× provider list rates; priority features.'),
('individual_max', 2, '2026-07-15', 45, 'user', 45, 1.0,
 '{"maxConcurrentPrivateJobs":4,"maxHourlyJobs":120}',
 32000, 48, 40, 4, 100, 18,
 '{"private_managed_ai":true,"team_automations":false,"advanced_strategy":true,"cad_design_review":true,"scenario_sweeps":true,"priority_features":true}',
 'Launch Individual Max: $45 API; ~2× Individual Pro hourly/rate/concurrency; priority features.'),
('team_pro', 2, '2026-07-15', 90, 'org', 90, 1.0,
 '{"maxConcurrentTeamJobs":5,"maxHourlyJobs":200}',
 64000, 100, 100, 5, 500, 25,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"priority_features":true}',
 'Launch Team Pro: $90 pooled API hard cut-off; org controls; priority features.'),
('team_max', 2, '2026-07-15', 185, 'org', 185, 1.0,
 '{"maxConcurrentTeamJobs":10,"maxHourlyJobs":400}',
 128000, 200, 200, 10, 1000, 40,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"scenario_sweeps":true,"advanced_team_admin":true,"priority_features":true}',
 'Launch Team Max: $185 pooled API; ~2× Team Pro rate limits; advanced CAD/strategy/code/admin.'),
('team_trial', 1, '2026-07-15', 20, 'org', 20, 1.0,
 '{"maxConcurrentTeamJobs":5,"maxHourlyJobs":200,"trialDays":7,"autoCharge":false}',
 64000, 100, 100, 5, 500, 25,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"priority_features":true,"trial":true}',
 'Week team trial: 7 days, $20 included API; no auto-charge unless they subscribe.')
ON CONFLICT(plan_code, version) DO UPDATE SET
  effective_at = excluded.effective_at,
  managed_allowance_usd = excluded.managed_allowance_usd,
  billing_owner_type = excluded.billing_owner_type,
  included_credits = excluded.included_credits,
  service_multiplier = excluded.service_multiplier,
  fair_use = excluded.fair_use,
  context_token_limit = excluded.context_token_limit,
  agent_step_limit = excluded.agent_step_limit,
  cad_iteration_limit = excluded.cad_iteration_limit,
  cad_concurrent_jobs = excluded.cad_concurrent_jobs,
  code_analysis_mb = excluded.code_analysis_mb,
  job_priority = excluded.job_priority,
  feature_flags = excluded.feature_flags,
  change_notice = excluded.change_notice;

-- Usage credit packs (1 credit = $1 provider API). Stripe Price IDs left null until admin configures Checkout.
INSERT INTO credit_packs(code, name, credit_amount_usd, purchase_price_usd, stripe_price_id, active) VALUES
('credits_25', 'Usage Credits $25', 25, 25, NULL, false),
('credits_50', 'Usage Credits $50', 50, 50, NULL, false),
('credits_100', 'Usage Credits $100', 100, 100, NULL, false),
('credits_250', 'Usage Credits $250', 250, 250, NULL, false),
('credits_500', 'Usage Credits $500', 500, 500, NULL, false)
ON CONFLICT(code) DO UPDATE SET
  name = excluded.name,
  credit_amount_usd = excluded.credit_amount_usd,
  purchase_price_usd = excluded.purchase_price_usd,
  updated_at = now();
