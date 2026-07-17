-- Forms & consent tracking. Which required forms (medical release, photo
-- consent, travel permission, code of conduct, waivers) each participant has
-- turned in. Stores names + status + an optional link to the signed document;
-- it deliberately does NOT store medical details or the document contents.

CREATE TABLE consent_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  name text NOT NULL,
  form_type text NOT NULL DEFAULT 'other'
    CHECK (form_type IN ('medical_release', 'photo_consent', 'code_of_conduct', 'travel_permission', 'liability_waiver', 'emergency_contact', 'handbook_ack', 'other')),
  required boolean NOT NULL DEFAULT true,
  document_url text,
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_forms_org_season_idx ON consent_forms(org_id, season_year);

CREATE TABLE consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES consent_forms(id) ON DELETE CASCADE,
  person_name text NOT NULL,
  guardian_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('pending', 'submitted', 'verified')),
  signed_on date,
  note text NOT NULL DEFAULT '',
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_records_form_idx ON consent_records(form_id);
CREATE INDEX consent_records_org_person_idx ON consent_records(org_id, person_name);

ALTER TABLE consent_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

-- Members maintain the forms and log submissions; destructive deletes are
-- limited to the row's author or an owner/admin.
CREATE POLICY consent_forms_read ON consent_forms FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY consent_forms_insert ON consent_forms FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY consent_forms_update ON consent_forms FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY consent_forms_delete ON consent_forms FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY consent_records_read ON consent_records FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY consent_records_insert ON consent_records FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND recorded_by = current_app_user_id());
CREATE POLICY consent_records_update ON consent_records FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY consent_records_delete ON consent_records FOR DELETE TO vantage_app USING (recorded_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON consent_forms, consent_records TO vantage_app, vantage_worker;
