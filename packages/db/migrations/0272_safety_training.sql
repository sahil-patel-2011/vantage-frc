-- Safety training tracker: shop safety modules + per-member completion/certification records.
-- Distinct from the general onboarding "training" feature (packages/db training tables, if any):
-- this is specifically the shop-safety certification trail (power tools, machine shop, PPE, etc.)
-- that substantiates who is currently cleared to use which equipment.

CREATE TABLE safety_training_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'shop_general'
    CHECK (category IN ('shop_general','power_tools','machine_shop','electrical','chemical','ppe','other')),
  description text,
  is_required boolean NOT NULL DEFAULT true,
  validity_months integer CHECK (validity_months IS NULL OR validity_months > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX safety_training_modules_org_idx ON safety_training_modules(org_id, is_required DESC, title);

ALTER TABLE safety_training_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY safety_training_modules_member_read ON safety_training_modules FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY safety_training_modules_member_insert ON safety_training_modules FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY safety_training_modules_member_update ON safety_training_modules FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY safety_training_modules_member_delete ON safety_training_modules FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON safety_training_modules TO vantage_app, vantage_worker;

CREATE TABLE safety_training_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES safety_training_modules(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES users(id),
  completed_on date NOT NULL,
  expires_on date,
  certificate_url text,
  notes text,
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX safety_training_completions_org_idx
  ON safety_training_completions(org_id, member_id, completed_on DESC);
CREATE INDEX safety_training_completions_module_idx
  ON safety_training_completions(module_id);

ALTER TABLE safety_training_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY safety_training_completions_member_read ON safety_training_completions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY safety_training_completions_member_insert ON safety_training_completions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND recorded_by = current_app_user_id());
CREATE POLICY safety_training_completions_member_update ON safety_training_completions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY safety_training_completions_member_delete ON safety_training_completions FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON safety_training_completions TO vantage_app, vantage_worker;
