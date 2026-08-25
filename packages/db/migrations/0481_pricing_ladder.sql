-- 0481_pricing_ladder.sql
-- THE NEW PRICING LADDER: four team plans — Free $0 · Pro $20 · Pro+ $60 · Max $100.
-- EVERY FEATURE ON EVERY PLAN (including Free): plans differ ONLY in the hosted AI
-- allowance layered on top of BYOK/local (which is unlimited-by-Vantage everywhere).
-- Free's allowance is budget-class only (sponsored pool: Mistral Small / Groq Llama 3.1
-- / Cohere Command R / Cerebras, or the OpenRouter free-model router — see
-- packages/agent sponsored-provider-pool + hosted-platform-keys). Paid allowances run
-- frontier models through the hosted platform path.
--
-- Existing org mapping (also mirrored in code as LEGACY_PLAN_CODE_MAP):
--   free -> free
--   access / individual_pro / individual_max -> pro
--   team_pro -> pro_plus
--   team_max -> max
-- Legacy pricing_plans rows stay (inactive) because billing_subscriptions /
-- trial_grants rows and Stripe subscription metadata still reference their codes.
-- Stripe Price IDs are never invented here — create Prices in the Dashboard and set
-- pricing_plans.stripe_price_id (admin surface) before opening checkout on new codes.

-- 1) New canonical plans (insert before entitlement versions: FK + margin guard read them).
INSERT INTO pricing_plans(code, name, monthly_price_usd, included_allowance_usd, features, active) VALUES
  ('pro', 'Pro', 20, 12,
   '["Every feature included — same product as Free","$12/mo hosted AI allowance on frontier models","BYOK/local providers stay unlimited by Vantage","Hard stop at the allowance — credits or PAYG are explicit"]',
   true),
  ('pro_plus', 'Pro+', 60, 40,
   '["Every feature included — same product as Free","$40/mo hosted AI allowance on frontier models","BYOK/local providers stay unlimited by Vantage","Hard stop at the allowance — credits or PAYG are explicit"]',
   true),
  ('max', 'Max', 100, 70,
   '["Every feature included — same product as Free","$70/mo hosted AI allowance on frontier models","BYOK/local providers stay unlimited by Vantage","Hard stop at the allowance — credits or PAYG are explicit"]',
   true)
ON CONFLICT(code) DO UPDATE SET
  name = excluded.name,
  monthly_price_usd = excluded.monthly_price_usd,
  included_allowance_usd = excluded.included_allowance_usd,
  features = excluded.features,
  active = excluded.active,
  updated_at = now();

-- 2) Refresh Free + trial; retire the legacy paid ladder from new checkout.
UPDATE pricing_plans SET
  monthly_price_usd = 0,
  included_allowance_usd = 3,
  features = '["Every feature included — nothing on Vantage is plan-gated","BYOK or local (Ollama / LM Studio) — unlimited by Vantage","$3/mo hosted allowance on budget models (Mistral / Llama-class)","Hard stop when the allowance runs out — no surprise bills"]'::jsonb,
  active = true,
  updated_at = now()
WHERE code = 'free';

UPDATE pricing_plans SET
  included_allowance_usd = 15,
  features = '["7-day admin-granted team trial","$15 hosted AI allowance on frontier models for the week","No surprise auto-charge unless the team subscribes"]'::jsonb,
  updated_at = now()
WHERE code = 'team_trial';

UPDATE pricing_plans SET active = false, updated_at = now()
WHERE code IN ('access', 'individual_pro', 'individual_max', 'team_pro', 'team_max');

-- 3) Entitlement versions: ALL feature flags true on EVERY plan (this is the
-- "every feature on every plan" guarantee — the only remaining plan difference is
-- managed_allowance_usd). Usage/abuse guards (fair_use, context/step/CAD/code
-- limits, priority) are equalized too so nothing is quietly tiered.
-- Free/trial have price 0, so validate_plan_margin skips them; paid rungs pass the
-- 0031 pass-through rule (price covers Stripe fees + $2 infra + 5% reserve).
INSERT INTO plan_entitlement_versions(
  plan_code, version, effective_at, managed_allowance_usd, billing_owner_type, included_credits,
  service_multiplier, fair_use, context_token_limit, agent_step_limit, cad_iteration_limit,
  cad_concurrent_jobs, code_analysis_mb, job_priority, feature_flags, change_notice
) VALUES
('free', 7, '2026-08-24', 3, 'org', 3, 0.75,
 '{"maxConcurrentTeamJobs":10,"maxHourlyJobs":400,"hostedModelClass":"budget"}',
 128000, 200, 200, 10, 1000, 25,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"scenario_sweeps":true,"advanced_team_admin":true,"priority_features":true,"payg_managed_routing":true}',
 'Pricing ladder: Free keeps every feature; $3/mo hosted allowance routed to budget-class sponsored/OpenRouter-free models; BYOK/local unlimited.'),
('pro', 1, '2026-08-24', 12, 'org', 12, 0.75,
 '{"maxConcurrentTeamJobs":10,"maxHourlyJobs":400}',
 128000, 200, 200, 10, 1000, 25,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"scenario_sweeps":true,"advanced_team_admin":true,"priority_features":true,"payg_managed_routing":true}',
 'Pricing ladder: Pro $20/mo adds a $12 hosted frontier-model allowance on top of unlimited BYOK/local; hard stop, no silent overage.'),
('pro_plus', 1, '2026-08-24', 40, 'org', 40, 0.75,
 '{"maxConcurrentTeamJobs":10,"maxHourlyJobs":400}',
 128000, 200, 200, 10, 1000, 25,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"scenario_sweeps":true,"advanced_team_admin":true,"priority_features":true,"payg_managed_routing":true}',
 'Pricing ladder: Pro+ $60/mo adds a $40 hosted frontier-model allowance on top of unlimited BYOK/local; hard stop, no silent overage.'),
('max', 1, '2026-08-24', 70, 'org', 70, 0.75,
 '{"maxConcurrentTeamJobs":10,"maxHourlyJobs":400}',
 128000, 200, 200, 10, 1000, 25,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"scenario_sweeps":true,"advanced_team_admin":true,"priority_features":true,"payg_managed_routing":true}',
 'Pricing ladder: Max $100/mo adds a $70 hosted frontier-model allowance on top of unlimited BYOK/local; hard stop, no silent overage.'),
('team_trial', 6, '2026-08-24', 15, 'org', 15, 0.75,
 '{"maxConcurrentTeamJobs":10,"maxHourlyJobs":400,"trialDays":7,"autoCharge":false}',
 128000, 200, 200, 10, 1000, 25,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"scenario_sweeps":true,"advanced_team_admin":true,"priority_features":true,"payg_managed_routing":true,"trial":true}',
 'Week team trial on the new ladder: 7 days, $15 hosted allowance; no auto-charge unless the team subscribes.')
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

-- 4) Remap existing org rows to the new ladder.
-- org_entitlements is the product-facing plan; entitlement_events keeps the audit trail.
UPDATE org_entitlements SET
  plan_code = CASE plan_code
    WHEN 'access' THEN 'pro'
    WHEN 'individual_pro' THEN 'pro'
    WHEN 'individual_max' THEN 'pro'
    WHEN 'team_pro' THEN 'pro_plus'
    WHEN 'team_max' THEN 'max'
  END,
  updated_at = now()
WHERE plan_code IN ('access', 'individual_pro', 'individual_max', 'team_pro', 'team_max');

INSERT INTO entitlement_events(org_id, plan_code, action, source, metadata)
SELECT org_id, plan_code, 'plan_code_remapped', 'migration',
       '{"migration":"0481_pricing_ladder","mapping":"access/individual*->pro, team_pro->pro_plus, team_max->max"}'::jsonb
FROM org_entitlements
WHERE plan_code IN ('pro', 'pro_plus', 'max');

-- org_plan_periods: rename the code on in-flight periods but keep the snapshotted
-- entitlement_version_id and managed_allowance_usd — teams keep what they were sold
-- (e.g. team_pro's $225 allowance) until the period renews on the new ladder.
UPDATE org_plan_periods SET
  plan_code = CASE plan_code
    WHEN 'access' THEN 'pro'
    WHEN 'individual_pro' THEN 'pro'
    WHEN 'individual_max' THEN 'pro'
    WHEN 'team_pro' THEN 'pro_plus'
    WHEN 'team_max' THEN 'max'
  END
WHERE plan_code IN ('access', 'individual_pro', 'individual_max', 'team_pro', 'team_max');

-- billing_subscriptions / trial_grants keep their legacy plan_code: those rows mirror
-- Stripe contracts and terms_snapshot; legacy pricing_plans rows remain (inactive) so
-- the FKs stay valid, and code resolves legacy codes via LEGACY_PLAN_CODE_MAP.
