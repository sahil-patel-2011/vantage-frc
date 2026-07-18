-- Degraded-mode acknowledgments: the org-scoped record of a team explicitly noting
-- ("acknowledging") that a reference data source (TBA / Statbotics / DB) is degraded and
-- that the team is proceeding with the last-good Neon reference cache / read-only fallbacks.
-- Health signals themselves come from the existing shared `data_source_health` /
-- `app_reference_cursor_summary()` / `tba_cache_freshness` surfaces (0013 / 0158 / 0034) —
-- this table only stores the team-facing acknowledgment trail, not the health data itself.

CREATE TABLE degraded_mode_acknowledgments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'tba'
    CHECK (source IN ('tba', 'statbotics', 'db', 'all')),
  mode text NOT NULL
    CHECK (mode IN ('degraded', 'unavailable', 'stale')),
  note text,
  acknowledged_by uuid NOT NULL REFERENCES users(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX degraded_mode_acknowledgments_org_idx
  ON degraded_mode_acknowledgments(org_id, acknowledged_at DESC);

ALTER TABLE degraded_mode_acknowledgments ENABLE ROW LEVEL SECURITY;

CREATE POLICY degraded_mode_acknowledgments_member_read ON degraded_mode_acknowledgments FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY degraded_mode_acknowledgments_member_insert ON degraded_mode_acknowledgments FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND acknowledged_by = current_app_user_id());
CREATE POLICY degraded_mode_acknowledgments_member_update ON degraded_mode_acknowledgments FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY degraded_mode_acknowledgments_member_delete ON degraded_mode_acknowledgments FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON degraded_mode_acknowledgments TO vantage_app, vantage_worker;
