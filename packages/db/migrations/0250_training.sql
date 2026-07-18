-- Training Matrix: who is certified/trained on shop skills (mill, lathe, wiring, drive, safety, …)
-- with sign-off and expiry. `training_skills` is the org's roster of trainable skills;
-- `training_certifications` records a member's sign-off against a skill, who certified it, and
-- when it expires. Distinct from any HR/onboarding record — this is a shop-floor safety/skills log.

CREATE TABLE training_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('mill','lathe','wiring','drive','safety','software','other')),
  description text,
  validity_months integer CHECK (validity_months IS NULL OR validity_months > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX training_skills_org_idx ON training_skills(org_id, category, name);

ALTER TABLE training_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY training_skills_member_read ON training_skills FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY training_skills_member_insert ON training_skills FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY training_skills_member_update ON training_skills FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY training_skills_member_delete ON training_skills FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON training_skills TO vantage_app, vantage_worker;

CREATE TABLE training_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES training_skills(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  certified_by uuid NOT NULL REFERENCES users(id),
  certified_at date NOT NULL,
  expires_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX training_certifications_org_member_idx ON training_certifications(org_id, member_user_id);
CREATE INDEX training_certifications_org_skill_idx ON training_certifications(org_id, skill_id);

ALTER TABLE training_certifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY training_certifications_member_read ON training_certifications FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY training_certifications_member_insert ON training_certifications FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND certified_by = current_app_user_id());
CREATE POLICY training_certifications_member_update ON training_certifications FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY training_certifications_member_delete ON training_certifications FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON training_certifications TO vantage_app, vantage_worker;
