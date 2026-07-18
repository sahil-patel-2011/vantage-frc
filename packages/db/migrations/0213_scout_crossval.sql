-- Live official cross-validation: compares a match-scout entry's per-field values against the
-- cached TBA `matches_ref.score_breakdown` (alliance-level official scoring) and records an
-- agree/conflict/unverifiable badge per field. Distinct from 0166 scouting-trust-layer (which
-- resolves human scout-vs-scout disagreements) — this validates scout entries against the
-- official record, not against each other.

CREATE TABLE scout_crossval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_scout_entry_id uuid NOT NULL REFERENCES match_scout_entries(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  match_key text NOT NULL REFERENCES matches_ref(match_key),
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  alliance_color text CHECK (alliance_color IN ('red', 'blue')),
  overall_status text NOT NULL DEFAULT 'unverifiable'
    CHECK (overall_status IN ('agree', 'conflict', 'unverifiable')),
  agree_count integer NOT NULL DEFAULT 0 CHECK (agree_count >= 0),
  conflict_count integer NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  unverifiable_count integer NOT NULL DEFAULT 0 CHECK (unverifiable_count >= 0),
  computed_by uuid NOT NULL REFERENCES users(id),
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, match_scout_entry_id)
);
CREATE INDEX scout_crossval_runs_org_event_idx ON scout_crossval_runs(org_id, event_key, computed_at DESC);

CREATE TABLE scout_crossval_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES scout_crossval_runs(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  field_label text NOT NULL,
  scout_value double precision,
  official_value double precision,
  status text NOT NULL CHECK (status IN ('agree', 'conflict', 'unverifiable')),
  delta_abs double precision,
  delta_pct double precision
);
CREATE INDEX scout_crossval_fields_run_idx ON scout_crossval_fields(run_id);

ALTER TABLE scout_crossval_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_crossval_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_crossval_runs_member_read ON scout_crossval_runs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_crossval_runs_member_insert ON scout_crossval_runs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND computed_by = current_app_user_id());
CREATE POLICY scout_crossval_runs_member_update ON scout_crossval_runs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_crossval_runs_member_delete ON scout_crossval_runs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY scout_crossval_fields_member_read ON scout_crossval_fields FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_crossval_fields_member_insert ON scout_crossval_fields FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_crossval_fields_member_update ON scout_crossval_fields FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_crossval_fields_member_delete ON scout_crossval_fields FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_crossval_runs, scout_crossval_fields TO vantage_app, vantage_worker;
