CREATE TABLE plan_entitlement_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),plan_code text NOT NULL REFERENCES pricing_plans(code),version integer NOT NULL,
 effective_at timestamptz NOT NULL,managed_allowance_usd numeric(12,6) NOT NULL,context_token_limit integer NOT NULL,
 agent_step_limit integer NOT NULL,cad_iteration_limit integer NOT NULL,cad_concurrent_jobs integer NOT NULL,
 code_analysis_mb integer NOT NULL,job_priority integer NOT NULL,feature_flags jsonb NOT NULL,change_notice text NOT NULL,
 created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(plan_code,version)
);
INSERT INTO plan_entitlement_versions(plan_code,version,effective_at,managed_allowance_usd,context_token_limit,agent_step_limit,cad_iteration_limit,cad_concurrent_jobs,code_analysis_mb,job_priority,feature_flags,change_notice) VALUES
('free',1,'2026-07-01',0,4000,6,3,1,5,0,'{"managed_models":false,"advanced_strategy":false,"cad_design_review":false,"team_usage_controls":false,"scenario_sweeps":false,"advanced_shared_context":false}', 'Launch defaults. BYOK/local provider cost is separate; feature limits still apply.'),
('managed_20',1,'2026-07-01',18,16000,24,20,2,50,10,'{"managed_models":true,"advanced_strategy":true,"cad_design_review":true,"team_usage_controls":true,"scenario_sweeps":false,"advanced_shared_context":false}', 'Vantage Pro launch period defaults; changes apply only to future periods/new subscriptions with notice.'),
('managed_50',1,'2026-07-01',45,64000,80,100,6,250,20,'{"managed_models":true,"advanced_strategy":true,"cad_design_review":true,"team_usage_controls":true,"scenario_sweeps":true,"advanced_shared_context":true}', 'Vantage Max launch period defaults; changes apply only to future periods/new subscriptions with notice.');
UPDATE pricing_plans SET included_allowance_usd=CASE code WHEN 'managed_20' THEN 18 WHEN 'managed_50' THEN 45 ELSE 0 END,
 features=CASE code
  WHEN 'free' THEN '["offline scouting","TBA and Statbotics lookup","CSV export","BYOK or local routing","standard prediction explanation","limited AI context and steps","CAD brief, mock, and local setup","basic code Q&A"]'::jsonb
  WHEN 'managed_20' THEN '["managed recommended models","larger unified context","advanced strategy factors and what-if analysis","richer CAD iteration, design review, and BOM","deeper code debugging","team usage controls","priority jobs"]'::jsonb
  WHEN 'managed_50' THEN '["materially higher context and step ceilings","premium eligible routing except PAYG-only models","scenario sweeps","more CAD iterations and concurrent jobs","larger repository analysis","advanced shared context and admin controls","higher job priority"]'::jsonb ELSE features END;
CREATE TABLE org_plan_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 plan_code text NOT NULL REFERENCES pricing_plans(code),entitlement_version_id uuid NOT NULL REFERENCES plan_entitlement_versions(id),
 period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,managed_allowance_usd numeric(12,6) NOT NULL,
 provider_cost_used_usd numeric(12,6) NOT NULL DEFAULT 0,status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,period_start)
);
CREATE TABLE platform_margin_config (
 id text PRIMARY KEY DEFAULT 'default',stripe_fee_percent numeric(6,4) NOT NULL DEFAULT 2.9,
 stripe_fixed_fee_usd numeric(8,4) NOT NULL DEFAULT .30,infrastructure_allocation_usd numeric(10,2) NOT NULL DEFAULT 2,
 gross_margin_warning_percent numeric(6,2) NOT NULL DEFAULT 10,updated_by uuid REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_margin_config(id) VALUES('default') ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION start_org_plan_period(target_org uuid,target_plan text,starts timestamptz,ends timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v plan_entitlement_versions%ROWTYPE;result uuid;
BEGIN SELECT * INTO v FROM plan_entitlement_versions WHERE plan_code=target_plan AND effective_at<=starts ORDER BY version DESC LIMIT 1;
 IF v.id IS NULL THEN RAISE EXCEPTION 'No entitlement version is effective for this plan period';END IF;
 INSERT INTO org_plan_periods(org_id,plan_code,entitlement_version_id,period_start,period_end,managed_allowance_usd,status)
 VALUES(target_org,target_plan,v.id,starts,ends,v.managed_allowance_usd,'active')
 ON CONFLICT(org_id,period_start) DO UPDATE SET status='active' RETURNING id INTO result;
 UPDATE org_billing SET credit_cap_usd=v.managed_allowance_usd,period_start=starts,period_end=ends WHERE org_id=target_org;
 RETURN result;END $$;

DO $$ BEGIN CREATE ROLE vantage_showcase NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO vantage_showcase;
CREATE TABLE showcase_decks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 title text NOT NULL,subtitle text,theme text NOT NULL DEFAULT 'impact',is_demo boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX showcase_decks_org_updated_idx ON showcase_decks(org_id,updated_at);
CREATE TABLE showcase_sections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 deck_id uuid NOT NULL REFERENCES showcase_decks(id) ON DELETE CASCADE,kind text NOT NULL,title text NOT NULL,
 student_content text NOT NULL DEFAULT '',ai_assisted_draft text,approved_content text,evidence_refs jsonb NOT NULL DEFAULT '[]',
 sort_order integer NOT NULL,approved_by uuid REFERENCES users(id),approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(deck_id,sort_order)
);
CREATE TABLE showcase_share_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 deck_id uuid NOT NULL REFERENCES showcase_decks(id) ON DELETE CASCADE,token_hash text UNIQUE NOT NULL,
 allowed_section_ids uuid[] NOT NULL,created_by uuid NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL,
 revoked_at timestamptz,last_used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE judge_practice_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 deck_id uuid REFERENCES showcase_decks(id) ON DELETE SET NULL,user_id uuid NOT NULL REFERENCES users(id),
 questions jsonb NOT NULL,responses jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE plan_entitlement_versions ENABLE ROW LEVEL SECURITY;ALTER TABLE org_plan_periods ENABLE ROW LEVEL SECURITY;ALTER TABLE platform_margin_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE showcase_decks ENABLE ROW LEVEL SECURITY;ALTER TABLE showcase_sections ENABLE ROW LEVEL SECURITY;ALTER TABLE showcase_share_tokens ENABLE ROW LEVEL SECURITY;ALTER TABLE judge_practice_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_entitlements_read ON plan_entitlement_versions FOR SELECT TO vantage_app USING(current_app_user_id() IS NOT NULL);
CREATE POLICY plan_entitlements_admin ON plan_entitlement_versions FOR ALL TO vantage_app USING(is_platform_admin()) WITH CHECK(is_platform_admin());
CREATE POLICY org_period_admin_read ON org_plan_periods FOR SELECT TO vantage_app USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) OR is_platform_admin());
CREATE POLICY margin_config_admin ON platform_margin_config FOR ALL TO vantage_app USING(is_platform_admin()) WITH CHECK(is_platform_admin());
CREATE POLICY showcase_member_read ON showcase_decks FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY showcase_member_write ON showcase_decks FOR ALL TO vantage_app USING(created_by=current_app_user_id() OR has_org_role(org_id,ARRAY['owner','admin']::org_role[])) WITH CHECK(is_org_member(org_id) AND (created_by=current_app_user_id() OR has_org_role(org_id,ARRAY['owner','admin']::org_role[])));
CREATE POLICY showcase_sections_member_read ON showcase_sections FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY showcase_sections_member_write ON showcase_sections FOR ALL TO vantage_app USING(is_org_member(org_id)) WITH CHECK(is_org_member(org_id));
CREATE POLICY showcase_tokens_admin ON showcase_share_tokens FOR ALL TO vantage_app USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) OR created_by=current_app_user_id()) WITH CHECK(is_org_member(org_id) AND created_by=current_app_user_id());
CREATE POLICY judge_practice_self ON judge_practice_sessions FOR ALL TO vantage_app USING(user_id=current_app_user_id()) WITH CHECK(user_id=current_app_user_id() AND is_org_member(org_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON plan_entitlement_versions,org_plan_periods,platform_margin_config,showcase_decks,showcase_sections,showcase_share_tokens,judge_practice_sessions TO vantage_app;
CREATE OR REPLACE FUNCTION get_showcase_snapshot(raw_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t showcase_share_tokens%ROWTYPE;result jsonb;
BEGIN SELECT * INTO t FROM showcase_share_tokens WHERE token_hash=encode(digest(raw_token,'sha256'),'hex') AND revoked_at IS NULL AND expires_at>now() FOR UPDATE;
 IF t.id IS NULL THEN RAISE EXCEPTION 'Showcase link is invalid or expired';END IF;UPDATE showcase_share_tokens SET last_used_at=now() WHERE id=t.id;
 SELECT jsonb_build_object('deck',jsonb_build_object('id',d.id,'title',d.title,'subtitle',d.subtitle,'theme',d.theme,'isDemo',d.is_demo),
 'sections',COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'kind',s.kind,'title',s.title,'content',COALESCE(s.approved_content,s.student_content),'aiAssisted',s.ai_assisted_draft IS NOT NULL,'evidenceRefs',s.evidence_refs) ORDER BY s.sort_order),'[]'::jsonb))
 INTO result FROM showcase_decks d LEFT JOIN showcase_sections s ON s.deck_id=d.id AND s.id=ANY(t.allowed_section_ids) WHERE d.id=t.deck_id GROUP BY d.id;
 RETURN result;END $$;
REVOKE ALL ON FUNCTION get_showcase_snapshot(text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION get_showcase_snapshot(text) TO vantage_showcase;
