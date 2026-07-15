CREATE TABLE org_auth_policies (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  allow_password boolean NOT NULL DEFAULT false,
  allow_google boolean NOT NULL DEFAULT true,
  allow_email_otp boolean NOT NULL DEFAULT true,
  mfa_policy text NOT NULL DEFAULT 'optional' CHECK(mfa_policy IN ('off','optional','required')),
  remembered_device_days integer NOT NULL DEFAULT 14 CHECK(remembered_device_days BETWEEN 0 AND 90),
  updated_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(allow_password OR allow_google OR allow_email_otp)
);
CREATE TABLE user_mfa_enrollments (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,encrypted_secret text NOT NULL,
  confirmed_at timestamptz,recovery_generation integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,generation integer NOT NULL,consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,code_hash)
);
CREATE TABLE mfa_step_up_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,totp_step text,
  UNIQUE(session_id,org_id)
);
CREATE TABLE remembered_mfa_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,label text NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz,last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_policy_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id),action text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_policy_audit_org_created_idx ON auth_policy_audit_events(org_id,created_at);

INSERT INTO org_auth_policies(org_id) SELECT id FROM organizations ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION create_default_org_auth_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO org_auth_policies(org_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;RETURN NEW;END $$;
CREATE TRIGGER organizations_default_auth_policy AFTER INSERT ON organizations FOR EACH ROW EXECUTE FUNCTION create_default_org_auth_policy();

ALTER TABLE org_auth_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mfa_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_step_up_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE remembered_mfa_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_policy_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_auth_policy_member_read ON org_auth_policies FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY org_auth_policy_admin_write ON org_auth_policies FOR ALL TO vantage_app
  USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
  WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND updated_by=current_app_user_id());
CREATE POLICY own_mfa_enrollment ON user_mfa_enrollments FOR ALL TO vantage_app USING(user_id=current_app_user_id()) WITH CHECK(user_id=current_app_user_id());
CREATE POLICY own_mfa_recovery ON mfa_recovery_codes FOR ALL TO vantage_app USING(user_id=current_app_user_id()) WITH CHECK(user_id=current_app_user_id());
CREATE POLICY own_mfa_step_up ON mfa_step_up_sessions FOR ALL TO vantage_app USING(user_id=current_app_user_id()) WITH CHECK(user_id=current_app_user_id() AND is_org_member(org_id));
CREATE POLICY own_remembered_mfa_device ON remembered_mfa_devices FOR ALL TO vantage_app USING(user_id=current_app_user_id()) WITH CHECK(user_id=current_app_user_id());
CREATE POLICY own_auth_policy_audit ON auth_policy_audit_events FOR INSERT TO vantage_app WITH CHECK(actor_user_id=current_app_user_id());
CREATE POLICY org_admin_auth_policy_audit_read ON auth_policy_audit_events FOR SELECT TO vantage_app USING(org_id IS NULL AND actor_user_id=current_app_user_id() OR has_org_role(org_id,ARRAY['owner','admin']::org_role[]));
GRANT SELECT,INSERT,UPDATE,DELETE ON org_auth_policies,user_mfa_enrollments,mfa_recovery_codes,mfa_step_up_sessions,remembered_mfa_devices,auth_policy_audit_events TO vantage_app;
