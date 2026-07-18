-- Scouting schema A/B comparison: candidate scouting form schemas and the field-level
-- completion samples logged against each while testing them (e.g. two forms trialed at a
-- scrimmage) so a lead scout can compare data quality/coverage before picking one to run
-- for the season. Self-contained: does not reference the form-builder tables (0254) so this
-- feature works standalone even if that feature isn't in use.

CREATE TABLE scouting_schema_ab_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  field_count integer NOT NULL DEFAULT 0 CHECK (field_count >= 0),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scouting_schema_ab_candidates_org_idx ON scouting_schema_ab_candidates(org_id, created_at DESC);

ALTER TABLE scouting_schema_ab_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY scouting_schema_ab_candidates_member_read ON scouting_schema_ab_candidates FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scouting_schema_ab_candidates_member_insert ON scouting_schema_ab_candidates FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY scouting_schema_ab_candidates_member_update ON scouting_schema_ab_candidates FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scouting_schema_ab_candidates_member_delete ON scouting_schema_ab_candidates FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON scouting_schema_ab_candidates TO vantage_app, vantage_worker;

CREATE TABLE scouting_schema_ab_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES scouting_schema_ab_candidates(id) ON DELETE CASCADE,
  match_number integer,
  fields_total integer NOT NULL CHECK (fields_total > 0),
  fields_completed integer NOT NULL CHECK (fields_completed >= 0),
  fill_seconds integer CHECK (fill_seconds IS NULL OR fill_seconds >= 0),
  had_error boolean NOT NULL DEFAULT false,
  notes text,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (fields_completed <= fields_total)
);
CREATE INDEX scouting_schema_ab_samples_org_candidate_idx
  ON scouting_schema_ab_samples(org_id, candidate_id, created_at DESC);

ALTER TABLE scouting_schema_ab_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY scouting_schema_ab_samples_member_read ON scouting_schema_ab_samples FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scouting_schema_ab_samples_member_insert ON scouting_schema_ab_samples FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY scouting_schema_ab_samples_member_update ON scouting_schema_ab_samples FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scouting_schema_ab_samples_member_delete ON scouting_schema_ab_samples FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON scouting_schema_ab_samples TO vantage_app, vantage_worker;
