-- Appealing Soft-UI / ops pricing: slightly lower subscription ladder + hosted API
-- billed at 0.75× typical provider list (~25% cheaper than BYOK at 1.0×).
-- Internal wholesale ≈ 0.5× list (margin ≈ 0.25×) — not exposed in user-facing copy.
-- Stripe Price IDs are not invented here — update Dashboard / admin-configured
-- stripe_price_id values to match before live checkout.

-- Allow hosted debit below 1.0× (legacy check required markup ≥ 1.0).
ALTER TABLE plan_entitlement_versions
  DROP CONSTRAINT IF EXISTS plan_entitlement_versions_service_multiplier_check;
ALTER TABLE plan_entitlement_versions
  ADD CONSTRAINT plan_entitlement_versions_service_multiplier_check
  CHECK (service_multiplier > 0 AND service_multiplier <= 5);

UPDATE pricing_plans SET
  monthly_price_usd = v.monthly_price_usd,
  included_allowance_usd = v.included_allowance_usd,
  features = v.features::jsonb,
  active = v.active,
  updated_at = now()
FROM (VALUES
  ('free', 0::numeric, 0::numeric,
   '["Soft-UI competition core: scouting, strategy, Event Day/Pit ops","BYOK or local OpenAI-compatible relay","No managed API allowance","Managed routing stronger via integrated tools/context — not BYOK sabotage"]',
   true),
  ('access', 69::numeric, 0::numeric,
   '["$69/mo light access","Unlocks Vantage managed Soft-UI routing at 75% of typical API rates","No large included API bucket — use Usage Credits or PAYG","Clarify vs Free BYOK"]',
   true),
  ('individual_pro', 109::numeric, 75::numeric,
   '["Private Soft-UI workspace","$75 included managed API allowance then hard cut-off","Scouting trust, strategy, and CAD review hubs","Hosted Usage Credits debit at 0.75× typical list (~25% vs BYOK)"]',
   true),
  ('individual_max', 159::numeric, 130::numeric,
   '["Private Soft-UI workspace","$130 included managed API allowance then hard cut-off","~2× Individual Pro rate/concurrency limits","Priority Soft-UI features + scenario sweeps"]',
   true),
  ('team_pro', 299::numeric, 225::numeric,
   '["Organization Soft-UI + ops","$225 pooled managed API allowance then hard cut-off","Shared AI, automations, Event Day/Pit/logistics","Org budget/member/feature controls"]',
   true),
  ('team_max', 549::numeric, 450::numeric,
   '["Organization Soft-UI + ops","$450 pooled managed API allowance then hard cut-off","~2× Team Pro rate limits","Advanced CAD, strategy, code, and admin"]',
   true),
  ('team_trial', 0::numeric, 39::numeric,
   '["7-day admin-granted team trial","$39 included managed API allowance","No surprise auto-charge unless they subscribe"]',
   false)
) AS v(code, monthly_price_usd, included_allowance_usd, features, active)
WHERE pricing_plans.code = v.code;

INSERT INTO plan_entitlement_versions(
  plan_code, version, effective_at, managed_allowance_usd, billing_owner_type, included_credits,
  service_multiplier, fair_use, context_token_limit, agent_step_limit, cad_iteration_limit,
  cad_concurrent_jobs, code_analysis_mb, job_priority, feature_flags, change_notice
) VALUES
('free', 6, '2026-07-20', 0, 'org', 0, 0.75,
 '{"maxConcurrentPrivateJobs":1}',
 4000, 6, 3, 1, 5, 0,
 '{"private_managed_ai":false,"team_automations":false,"advanced_strategy":false,"cad_design_review":false,"priority_features":false}',
 'Appealing Free: Soft-UI competition core; BYOK/local OK; $0 managed allowance.'),
('access', 5, '2026-07-20', 0, 'user', 0, 0.75,
 '{"maxConcurrentPrivateJobs":2}',
 16000, 24, 20, 2, 50, 8,
 '{"private_managed_ai":true,"team_automations":false,"advanced_strategy":true,"cad_design_review":true,"priority_features":false,"payg_managed_routing":true}',
 'Access $69/mo unlocks managed Soft-UI routing at 0.75× typical list without a large included bucket.'),
('individual_pro', 6, '2026-07-20', 75, 'user', 75, 0.75,
 '{"maxConcurrentPrivateJobs":2,"maxHourlyJobs":60}',
 16000, 24, 20, 2, 50, 10,
 '{"private_managed_ai":true,"team_automations":false,"advanced_strategy":true,"cad_design_review":true,"priority_features":true}',
 'Appealing Individual Pro: $109/mo, $75 API hard cut-off; Soft-UI scouting trust + strategy/CAD; hosted 0.75× list.'),
('individual_max', 6, '2026-07-20', 130, 'user', 130, 0.75,
 '{"maxConcurrentPrivateJobs":4,"maxHourlyJobs":120}',
 32000, 48, 40, 4, 100, 18,
 '{"private_managed_ai":true,"team_automations":false,"advanced_strategy":true,"cad_design_review":true,"scenario_sweeps":true,"priority_features":true}',
 'Appealing Individual Max: $159/mo, $130 API; ~2× Individual Pro hourly/rate/concurrency; priority Soft-UI.'),
('team_pro', 6, '2026-07-20', 225, 'org', 225, 0.75,
 '{"maxConcurrentTeamJobs":5,"maxHourlyJobs":200}',
 64000, 100, 100, 5, 500, 25,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"priority_features":true}',
 'Appealing Team Pro: $299/mo, $225 pooled API hard cut-off; Event Day/Pit/ops Soft-UI; org controls.'),
('team_max', 6, '2026-07-20', 450, 'org', 450, 0.75,
 '{"maxConcurrentTeamJobs":10,"maxHourlyJobs":400}',
 128000, 200, 200, 10, 1000, 40,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"scenario_sweeps":true,"advanced_team_admin":true,"priority_features":true}',
 'Appealing Team Max: $549/mo, $450 pooled API; ~2× Team Pro rate limits; advanced CAD/strategy/code/admin.'),
('team_trial', 5, '2026-07-20', 39, 'org', 39, 0.75,
 '{"maxConcurrentTeamJobs":5,"maxHourlyJobs":200,"trialDays":7,"autoCharge":false}',
 64000, 100, 100, 5, 500, 25,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"priority_features":true,"trial":true}',
 'Week team trial: 7 days, $39 included API; no auto-charge unless they subscribe.')
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
