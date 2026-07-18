-- Scout shift load balancer: roster of scouts + generated rotation plans that respect roster
-- size and cap consecutive-match streaks per scout to avoid fatigue burnout during events.

CREATE TABLE shift_balancer_scouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shift_balancer_scouts_org_idx ON shift_balancer_scouts(org_id, active);

CREATE TABLE shift_balancer_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  match_count integer NOT NULL CHECK (match_count > 0),
  stations text[] NOT NULL,
  max_consecutive_matches integer NOT NULL CHECK (max_consecutive_matches > 0),
  assignments jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shift_balancer_plans_org_idx ON shift_balancer_plans(org_id, created_at DESC);

ALTER TABLE shift_balancer_scouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_balancer_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY shift_balancer_scouts_member_read ON shift_balancer_scouts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY shift_balancer_scouts_member_insert ON shift_balancer_scouts FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY shift_balancer_scouts_member_update ON shift_balancer_scouts FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY shift_balancer_scouts_member_delete ON shift_balancer_scouts FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY shift_balancer_plans_member_read ON shift_balancer_plans FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY shift_balancer_plans_member_insert ON shift_balancer_plans FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND generated_by = current_app_user_id());
CREATE POLICY shift_balancer_plans_member_update ON shift_balancer_plans FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY shift_balancer_plans_member_delete ON shift_balancer_plans FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON shift_balancer_scouts, shift_balancer_plans TO vantage_app, vantage_worker;
