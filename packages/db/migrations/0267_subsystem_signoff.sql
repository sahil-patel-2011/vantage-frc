-- Subsystem sign-off: the build-readiness gate record for each robot subsystem
-- (drivetrain, intake, scoring, climber, electrical, software…). Each subsystem must clear
-- a fixed set of review gates (design, fabrication, assembly, wiring, programming, field_test);
-- a sign-off record is one reviewer's approve/reject decision on one gate, so "competition
-- ready" is backed by an auditable trail rather than a verbal "yeah it's fine".

CREATE TABLE subsystem_signoff_subsystems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('drivetrain','intake','scoring','climber','electrical','software','other')),
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','ready_for_review','signed_off','blocked')),
  notes text,
  season_year integer NOT NULL,
  added_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subsystem_signoff_subsystems_org_season_idx
  ON subsystem_signoff_subsystems(org_id, season_year, name);

ALTER TABLE subsystem_signoff_subsystems ENABLE ROW LEVEL SECURITY;

CREATE POLICY subsystem_signoff_subsystems_member_read ON subsystem_signoff_subsystems FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY subsystem_signoff_subsystems_member_insert ON subsystem_signoff_subsystems FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND added_by = current_app_user_id());
CREATE POLICY subsystem_signoff_subsystems_member_update ON subsystem_signoff_subsystems FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY subsystem_signoff_subsystems_member_delete ON subsystem_signoff_subsystems FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON subsystem_signoff_subsystems TO vantage_app, vantage_worker;

CREATE TABLE subsystem_signoff_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subsystem_id uuid NOT NULL REFERENCES subsystem_signoff_subsystems(id) ON DELETE CASCADE,
  gate text NOT NULL
    CHECK (gate IN ('design','fabrication','assembly','wiring','programming','field_test')),
  decision text NOT NULL DEFAULT 'approved'
    CHECK (decision IN ('approved','rejected')),
  reviewer_id uuid NOT NULL REFERENCES users(id),
  signed_on date NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subsystem_signoff_records_org_subsystem_idx
  ON subsystem_signoff_records(org_id, subsystem_id, signed_on DESC);

ALTER TABLE subsystem_signoff_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY subsystem_signoff_records_member_read ON subsystem_signoff_records FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY subsystem_signoff_records_member_insert ON subsystem_signoff_records FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND reviewer_id = current_app_user_id());
CREATE POLICY subsystem_signoff_records_member_update ON subsystem_signoff_records FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY subsystem_signoff_records_member_delete ON subsystem_signoff_records FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON subsystem_signoff_records TO vantage_app, vantage_worker;
