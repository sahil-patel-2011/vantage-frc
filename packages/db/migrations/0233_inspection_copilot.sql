-- Inspection-readiness copilot (Build pillar).
-- From the team's declared weight budget, frame/bumper limits, and wiring/power limits (from the
-- current manual) plus the measured/installed robot state, deterministically predict likely
-- inspection failures (over weight, out-of-range bumper height/thickness, exceeded perimeter,
-- oversized main breaker, unsecured battery, unlabeled wiring, radio power/bypass-switch faults)
-- before the team travels. Declared limits and measurements are both stored per check so the
-- flagged diff stays auditable.

CREATE TABLE inspection_copilot_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  robot_name text NOT NULL,
  weight_budget jsonb NOT NULL DEFAULT '{}'::jsonb,
  frame_bumper jsonb NOT NULL DEFAULT '{}'::jsonb,
  wiring_power jsonb NOT NULL DEFAULT '{}'::jsonb,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_score numeric(4, 3) NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 1),
  total_weight_lbs numeric(6, 2) NOT NULL DEFAULT 0 CHECK (total_weight_lbs >= 0),
  summary text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inspection_copilot_checks_org_season_idx
  ON inspection_copilot_checks(org_id, season_year, created_at DESC);

ALTER TABLE inspection_copilot_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY inspection_copilot_checks_member_read ON inspection_copilot_checks FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY inspection_copilot_checks_member_insert ON inspection_copilot_checks FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY inspection_copilot_checks_member_update ON inspection_copilot_checks FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY inspection_copilot_checks_member_delete ON inspection_copilot_checks FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON inspection_copilot_checks TO vantage_app, vantage_worker;
