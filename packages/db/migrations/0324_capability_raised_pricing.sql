-- Capability-raised catalog: subscription prices reflect expanded product surface
-- (custom scout form builder, voice STT, hard usage cutoffs, Soft-UI hubs,
-- strategy/CAD integration, offline scouting, etc.). Modest included-API bumps;
-- keep 1.0× pass-through (no Vantage markup). Stripe Price IDs are not invented
-- here — update Dashboard / admin-configured stripe_price_id values to match.

UPDATE pricing_plans SET
  monthly_price_usd = v.monthly_price_usd,
  included_allowance_usd = v.included_allowance_usd,
  features = v.features::jsonb,
  active = v.active,
  updated_at = now()
FROM (VALUES
  ('free', 0::numeric, 0::numeric,
   '["Complete non-AI competition core","BYOK or local OpenAI-compatible relay","No managed API allowance","Managed routing stronger via integrated tools/context — not BYOK sabotage"]',
   true),
  ('access', 55::numeric, 0::numeric,
   '["$55/mo light access","Unlocks Vantage managed routing at provider list rates","No large included API bucket — use Usage Credits or PAYG","Clarify vs Free BYOK"]',
   true),
  ('individual_pro', 79::numeric, 50::numeric,
   '["Private only","$50 included managed API allowance then hard cut-off","Priority access to new features","Usage Credit = $1 provider API at list rates"]',
   true),
  ('individual_max', 119::numeric, 85::numeric,
   '["Private only","$85 included managed API allowance then hard cut-off","~2× Individual Pro rate/concurrency limits","Priority access to new features"]',
   true),
  ('team_pro', 229::numeric, 150::numeric,
   '["Organization-wide","$150 pooled managed API allowance then hard cut-off","Shared AI and automations","Org budget/member/feature controls"]',
   true),
  ('team_max', 449::numeric, 300::numeric,
   '["Organization-wide","$300 pooled managed API allowance then hard cut-off","~2× Team Pro rate limits","Advanced CAD, strategy, code, and admin"]',
   true),
  ('team_trial', 0::numeric, 30::numeric,
   '["7-day admin-granted team trial","$30 included managed API allowance","No surprise auto-charge unless they subscribe"]',
   false)
) AS v(code, monthly_price_usd, included_allowance_usd, features, active)
WHERE pricing_plans.code = v.code;

INSERT INTO plan_entitlement_versions(
  plan_code, version, effective_at, managed_allowance_usd, billing_owner_type, included_credits,
  service_multiplier, fair_use, context_token_limit, agent_step_limit, cad_iteration_limit,
  cad_concurrent_jobs, code_analysis_mb, job_priority, feature_flags, change_notice
) VALUES
('free', 4, '2026-07-18', 0, 'org', 0, 1.0,
 '{"maxConcurrentPrivateJobs":1}',
 4000, 6, 3, 1, 5, 0,
 '{"private_managed_ai":false,"team_automations":false,"advanced_strategy":false,"cad_design_review":false,"priority_features":false}',
 'Capability-raised Free: BYOK/local OK; $0 managed allowance.'),
('access', 3, '2026-07-18', 0, 'user', 0, 1.0,
 '{"maxConcurrentPrivateJobs":2}',
 16000, 24, 20, 2, 50, 8,
 '{"private_managed_ai":true,"team_automations":false,"advanced_strategy":true,"cad_design_review":true,"priority_features":false,"payg_managed_routing":true}',
 'Access $55/mo unlocks managed routing at list rates without a large included bucket.'),
('individual_pro', 4, '2026-07-18', 50, 'user', 50, 1.0,
 '{"maxConcurrentPrivateJobs":2,"maxHourlyJobs":60}',
 16000, 24, 20, 2, 50, 10,
 '{"private_managed_ai":true,"team_automations":false,"advanced_strategy":true,"cad_design_review":true,"priority_features":true}',
 'Capability-raised Individual Pro: $79/mo, $50 API hard cut-off; 1.0× provider list rates; priority features.'),
('individual_max', 4, '2026-07-18', 85, 'user', 85, 1.0,
 '{"maxConcurrentPrivateJobs":4,"maxHourlyJobs":120}',
 32000, 48, 40, 4, 100, 18,
 '{"private_managed_ai":true,"team_automations":false,"advanced_strategy":true,"cad_design_review":true,"scenario_sweeps":true,"priority_features":true}',
 'Capability-raised Individual Max: $119/mo, $85 API; ~2× Individual Pro hourly/rate/concurrency; priority features.'),
('team_pro', 4, '2026-07-18', 150, 'org', 150, 1.0,
 '{"maxConcurrentTeamJobs":5,"maxHourlyJobs":200}',
 64000, 100, 100, 5, 500, 25,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"priority_features":true}',
 'Capability-raised Team Pro: $229/mo, $150 pooled API hard cut-off; org controls; priority features.'),
('team_max', 4, '2026-07-18', 300, 'org', 300, 1.0,
 '{"maxConcurrentTeamJobs":10,"maxHourlyJobs":400}',
 128000, 200, 200, 10, 1000, 40,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"scenario_sweeps":true,"advanced_team_admin":true,"priority_features":true}',
 'Capability-raised Team Max: $449/mo, $300 pooled API; ~2× Team Pro rate limits; advanced CAD/strategy/code/admin.'),
('team_trial', 3, '2026-07-18', 30, 'org', 30, 1.0,
 '{"maxConcurrentTeamJobs":5,"maxHourlyJobs":200,"trialDays":7,"autoCharge":false}',
 64000, 100, 100, 5, 500, 25,
 '{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"priority_features":true,"trial":true}',
 'Week team trial: 7 days, $30 included API; no auto-charge unless they subscribe.')
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
