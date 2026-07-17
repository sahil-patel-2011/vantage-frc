-- Decision Log (ADR): engineering/strategy decisions with context, options considered, the
-- call, and the rationale. Supports supersession (a later accepted decision replaces an
-- earlier one). Distinct from engineering_changes (what changed). Org-scoped, RLS.

CREATE TABLE decision_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'design'
    CHECK (category IN ('design','strategy','build','business','process','other')),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','accepted','rejected','superseded')),
  context text,
  decision text,
  rationale text,
  options jsonb NOT NULL DEFAULT '[]',
  decided_on date,
  deciders text,
  supersedes_id uuid REFERENCES decision_records(id) ON DELETE SET NULL,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decision_records_org_season_idx ON decision_records(org_id, season_year, created_at DESC);

ALTER TABLE decision_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY decision_records_member_read ON decision_records FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY decision_records_member_insert ON decision_records FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY decision_records_member_update ON decision_records FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY decision_records_member_delete ON decision_records FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON decision_records TO vantage_app, vantage_worker;
