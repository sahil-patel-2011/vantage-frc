-- Safety-captain tooling. safety_incidents is the injury / near-miss log every
-- FRC team is expected to keep; safety_certifications is the tool sign-off
-- register (which students are cleared to run the mill, bandsaw, welder, etc.).

CREATE TABLE safety_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('near_miss', 'minor', 'moderate', 'serious')),
  occurred_on date NOT NULL,
  location text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  injured_person text NOT NULL DEFAULT '',
  treatment text NOT NULL DEFAULT 'none' CHECK (treatment IN ('none', 'first_aid', 'professional')),
  corrective_action text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'closed')),
  reported_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX safety_incidents_org_idx ON safety_incidents(org_id, occurred_on DESC);

CREATE TABLE safety_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_name text NOT NULL,
  cert_type text NOT NULL CHECK (cert_type IN ('general_safety', 'hand_tools', 'power_tools', 'mill_lathe', 'bandsaw', 'drill_press', 'welding', '3d_printer', 'electrical', 'battery', 'first_aid', 'other')),
  completed_on date NOT NULL,
  expires_on date,
  notes text NOT NULL DEFAULT '',
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX safety_certifications_org_idx ON safety_certifications(org_id, person_name);

ALTER TABLE safety_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_certifications ENABLE ROW LEVEL SECURITY;

-- Any member can report an incident or record a certification; destructive
-- deletes are limited to the row's author or an owner/admin.
CREATE POLICY safety_incidents_read ON safety_incidents FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY safety_incidents_insert ON safety_incidents FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND reported_by = current_app_user_id());
CREATE POLICY safety_incidents_update ON safety_incidents FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY safety_incidents_delete ON safety_incidents FOR DELETE TO vantage_app USING (reported_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY safety_certifications_read ON safety_certifications FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY safety_certifications_insert ON safety_certifications FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND recorded_by = current_app_user_id());
CREATE POLICY safety_certifications_delete ON safety_certifications FOR DELETE TO vantage_app USING (recorded_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON safety_incidents, safety_certifications TO vantage_app, vantage_worker;
