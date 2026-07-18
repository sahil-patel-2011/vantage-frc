-- Safety Incident Log: people- and shop-safety incidents (injuries, near-misses, equipment /
-- electrical / chemical hazards) with a corrective action tracked to closure. Distinct from
-- robot failures/repairs. Org-scoped, collaborative, per-org RLS.

CREATE TABLE incident_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('injury','near_miss','equipment','electrical','chemical','property','other')),
  severity text NOT NULL DEFAULT 'moderate'
    CHECK (severity IN ('minor','moderate','serious','critical')),
  occurred_on date NOT NULL,
  location text,
  description text,
  corrective_action text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','investigating','action_pending','resolved','closed')),
  owner text,
  due_on date,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incident_reports_org_season_idx ON incident_reports(org_id, season_year, occurred_on DESC);

ALTER TABLE incident_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY incident_reports_member_read ON incident_reports FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY incident_reports_member_insert ON incident_reports FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY incident_reports_member_update ON incident_reports FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY incident_reports_member_delete ON incident_reports FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON incident_reports TO vantage_app, vantage_worker;
