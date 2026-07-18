-- Weight/power budget auto-reconciler: snapshots of as-designed mass (weight_components /
-- weight_settings) and current draw (power_loads) drift against target, with a deterministic
-- trim proposal naming which subsystem to cut and by how much. Read-only against the existing
-- weight/power budget tables; this migration only adds the reconciliation-run history table.

CREATE TABLE budget_reconciler_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  mass_total_lbs numeric(7, 2) NOT NULL DEFAULT 0 CHECK (mass_total_lbs >= 0),
  mass_limit_lbs numeric(7, 2) NOT NULL DEFAULT 0 CHECK (mass_limit_lbs >= 0),
  mass_drift_lbs numeric(7, 2) NOT NULL DEFAULT 0,
  mass_status text NOT NULL DEFAULT 'on_target' CHECK (mass_status IN ('over', 'under', 'on_target')),
  current_total_amps numeric(8, 2) NOT NULL DEFAULT 0 CHECK (current_total_amps >= 0),
  current_breaker_amps numeric(8, 2) NOT NULL DEFAULT 0 CHECK (current_breaker_amps >= 0),
  current_drift_amps numeric(8, 2) NOT NULL DEFAULT 0,
  current_status text NOT NULL DEFAULT 'on_target' CHECK (current_status IN ('over', 'under', 'on_target')),
  trim_subsystem text,
  trim_amount_lbs numeric(7, 2),
  rationale text NOT NULL DEFAULT '',
  confidence numeric(4, 3) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX budget_reconciler_reports_org_season_idx ON budget_reconciler_reports(org_id, season_year, created_at DESC);

ALTER TABLE budget_reconciler_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY budget_reconciler_reports_member_read ON budget_reconciler_reports FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY budget_reconciler_reports_member_insert ON budget_reconciler_reports FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY budget_reconciler_reports_member_update ON budget_reconciler_reports FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY budget_reconciler_reports_member_delete ON budget_reconciler_reports FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON budget_reconciler_reports TO vantage_app, vantage_worker;
