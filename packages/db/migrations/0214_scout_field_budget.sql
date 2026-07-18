-- Field-count budget linter: schema-design time snapshots of a scouting schema's per-phase
-- field counts, checked against a realistic per-match field-count budget so teams catch
-- over-ambitious schemas (too many fields to reliably record live) before an event.

CREATE TABLE scout_field_budget_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schema_name text NOT NULL,
  auto_fields integer NOT NULL DEFAULT 0 CHECK (auto_fields >= 0),
  teleop_fields integer NOT NULL DEFAULT 0 CHECK (teleop_fields >= 0),
  endgame_fields integer NOT NULL DEFAULT 0 CHECK (endgame_fields >= 0),
  pit_fields integer NOT NULL DEFAULT 0 CHECK (pit_fields >= 0),
  post_match_fields integer NOT NULL DEFAULT 0 CHECK (post_match_fields >= 0),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scout_field_budget_snapshots_org_created_idx
  ON scout_field_budget_snapshots(org_id, created_at DESC);

ALTER TABLE scout_field_budget_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_field_budget_snapshots_member_read ON scout_field_budget_snapshots FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_field_budget_snapshots_member_insert ON scout_field_budget_snapshots FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY scout_field_budget_snapshots_member_update ON scout_field_budget_snapshots FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_field_budget_snapshots_member_delete ON scout_field_budget_snapshots FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_field_budget_snapshots TO vantage_app, vantage_worker;
