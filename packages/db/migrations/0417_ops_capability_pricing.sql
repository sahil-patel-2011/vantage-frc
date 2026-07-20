-- Ops / Soft-UI / scouting-trust capability raise: subscription prices reflect the
-- broader product surface (Soft-UI hubs, scouting trust + offline/voice, Event Day /
-- Pit / logistics ops, CAD/strategy/AI budgets). Modest included-API bumps; keep 1.0×
-- pass-through (no Vantage markup). Stripe Price IDs are not invented here — update
-- Dashboard / admin-configured stripe_price_id values to match before live checkout.

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
  ('access', 79::numeric, 0::numeric,
   '["$79/mo light access","Unlocks Vantage managed Soft-UI routing at provider list rates","No large included API bucket — use Usage Credits or PAYG","Clarify vs Free BYOK"]',
   true),
  ('individual_pro', 129::numeric, 75::numeric,
   '["Private Soft-UI workspace","$75 included managed API allowance then hard cut-off","Scouting trust, strategy, and CAD review hubs","Usage Credit = $1 provider API at list rates"]',
   true),
  ('individual_max', 189::numeric, 130::numeric,
   '["Private Soft-UI workspace","$130 included managed API allowance then hard cut-off","~2× Individual Pro rate/concurrency limits","Priority Soft-UI features + scenario sweeps"]',
   true),
  ('team_pro', 349::numeric, 225::numeric,
   '["Organization Soft-UI + ops","$225 pooled managed API allowance then hard cut-off","Shared AI, automations, Event Day/Pit/logistics","Org budget/member/feature controls"]',
   true),
  ('team_max', 649::numeric, 450::numeric,
   '["Organization Soft-UI + ops","$450 pooled managed API allowance then hard cut-off","~2× Team Pro rate limits","Advanced CAD, strategy, code, and admin"]',
   true),
  ('team_trial', 0::numeric, 45::numeric,
   '["7-day admin-granted team trial","$45 included managed API allowance","No surprise auto-charge unless they subscribe"]',
   false)
) AS v(code, monthly_price_usd, included_allowance_usd, features, active)
WHERE pricing_plans.code = v.code;

INSERT INTO plan_entitlement_versions(
  plan_code, version, effective_at, managed_allowance_usd, billing_owner_type, included_credits,
  service_multiplier, fair_use, context_token_limit, agent_step_limit, cad_iteration_limit,
  cad_concurrent_jobs, code_analysis_mb, job_priority, feature_flags, change_notice
) VALUES
('free', 5, '2026-07-20', 0, 'org', 0, 1.0,
 '{"maxConcurrentPrivateJobs":1}',
 4000, 6, 3, 1, 5, 0,
 '{"private_managed_ai":false,"team_automations":false,"advanced_strategy":false,"cad_design_review":false,"priority_features":false}',
 'Ops-capability Free: Soft-UI competition core; BYOK/local OK; $0 managed allowance.'),
('access', 4, '2026-07-20', 0, 'user', 0, 1.0,
 '{"maxConcurrentPrivateJobs":2}',
 16000, 24, 20, 2, 50, 8,
 '{"private_managed_ai":true,"team_automations":false,"advanced_strategy":true,"cad_design_review":true,"priority_features":false,"payg_managed_routing":true}',
 'Access $79/mo unlocks managed Soft-UI routing at list rates without a large included bucket.'),
('individual_pro', 5, '2026-07-20', 75, 'user', 75, 1.0,
 '{"maxConcurrentPrivateJobs":2,"maxHourlyJobs":60}',
 16000, 24, 20, 2, 50, 10,
 '{"private_managed_ai":true,"team_automations":false,"advanced_strategy":true,"cad_design_review":true,"priority_features":true}',
 'Ops-capability Individual Pro: $129/mo, $75 API hard cut-off; Soft-UI scouting trust + strategy/CAD; 1.0× list rates.'),
('individual_max', 5, '2026-07-20', 130, 'user', 130, 1.0,
 '{"maxConcurrentPrivateJobs":4,"maxHourlyJobs":120}',
 32000, 48, 40, 4, 100, 18,
 '{"private_managed_ai":true,"team_automations":false,"advanced_strategy":true,"cad_design_review":true,"scenario_sweeps":true,"priority_features":true}',
 'Ops-capability Individual Max: $189/mo, $130 API; ~2× Individual Pro hourly/rate/concurrency; priority Soft-UI.'),
('team_pro', 5, '2026-07-20', 225, 'org', 225, 1.0,
 '{"maxConcurrentTeamJobs":5,"maxHourlyJobs":200}',
 64000, 100, 100, 5, 500, 25,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"priority_features":true}',
 'Ops-capability Team Pro: $349/mo, $225 pooled API hard cut-off; Event Day/Pit/ops Soft-UI; org controls.'),
('team_max', 5, '2026-07-20', 450, 'org', 450, 1.0,
 '{"maxConcurrentTeamJobs":10,"maxHourlyJobs":400}',
 128000, 200, 200, 10, 1000, 40,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"scenario_sweeps":true,"advanced_team_admin":true,"priority_features":true}',
 'Ops-capability Team Max: $649/mo, $450 pooled API; ~2× Team Pro rate limits; advanced CAD/strategy/code/admin.'),
('team_trial', 4, '2026-07-20', 45, 'org', 45, 1.0,
 '{"maxConcurrentTeamJobs":5,"maxHourlyJobs":200,"trialDays":7,"autoCharge":false}',
 64000, 100, 100, 5, 500, 25,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"priority_features":true,"trial":true}',
 'Week team trial: 7 days, $45 included API; no auto-charge unless they subscribe.')
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
