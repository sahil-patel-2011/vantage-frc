-- Tuning autopilot (Build pillar).
-- Structured PID/feedforward tuning session log: each session targets one subsystem/controller,
-- and each iteration records the gain set tried plus the observed test result (overshoot,
-- settling time, steady-state error, oscillation). The suggested next gain set is derived
-- deterministically from the team's OWN logged iteration trend for that session — never invented.

CREATE TABLE tuning_autopilot_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  subsystem text NOT NULL,
  controller_type text NOT NULL DEFAULT 'pid'
    CHECK (controller_type IN ('pid', 'pidf', 'feedforward')),
  goal text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'converged', 'abandoned')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tuning_autopilot_sessions_org_season_idx
  ON tuning_autopilot_sessions(org_id, season_year, created_at DESC);

CREATE TABLE tuning_autopilot_iterations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES tuning_autopilot_sessions(id) ON DELETE CASCADE,
  iteration_index integer NOT NULL DEFAULT 0,
  k_p numeric(10, 5) NOT NULL DEFAULT 0,
  k_i numeric(10, 5) NOT NULL DEFAULT 0,
  k_d numeric(10, 5) NOT NULL DEFAULT 0,
  k_s numeric(10, 5) NOT NULL DEFAULT 0,
  k_v numeric(10, 5) NOT NULL DEFAULT 0,
  k_g numeric(10, 5) NOT NULL DEFAULT 0,
  overshoot_pct numeric(6, 2) NOT NULL DEFAULT 0 CHECK (overshoot_pct >= 0),
  settling_time_sec numeric(6, 3) NOT NULL DEFAULT 0 CHECK (settling_time_sec >= 0),
  steady_state_error numeric(8, 4) NOT NULL DEFAULT 0 CHECK (steady_state_error >= 0),
  oscillating boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tuning_autopilot_iterations_session_idx
  ON tuning_autopilot_iterations(session_id, iteration_index);
CREATE INDEX tuning_autopilot_iterations_org_idx ON tuning_autopilot_iterations(org_id);

ALTER TABLE tuning_autopilot_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuning_autopilot_iterations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tuning_autopilot_sessions_member_read ON tuning_autopilot_sessions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY tuning_autopilot_sessions_member_insert ON tuning_autopilot_sessions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY tuning_autopilot_sessions_member_update ON tuning_autopilot_sessions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY tuning_autopilot_sessions_member_delete ON tuning_autopilot_sessions FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

CREATE POLICY tuning_autopilot_iterations_member_read ON tuning_autopilot_iterations FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY tuning_autopilot_iterations_member_insert ON tuning_autopilot_iterations FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY tuning_autopilot_iterations_member_update ON tuning_autopilot_iterations FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY tuning_autopilot_iterations_member_delete ON tuning_autopilot_iterations FOR DELETE TO vantage_app
  USING (
    logged_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON tuning_autopilot_sessions, tuning_autopilot_iterations
  TO vantage_app, vantage_worker;
