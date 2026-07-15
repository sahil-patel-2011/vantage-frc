-- Run ownership/migrations as vantage_owner. Runtime roles receive only explicit grants.
DO $$ BEGIN
  CREATE ROLE vantage_app NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE vantage_worker NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE vantage_auth NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE vantage_marketing NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO vantage_app, vantage_worker, vantage_auth, vantage_marketing;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vantage_worker;
GRANT SELECT, INSERT, UPDATE ON waitlist_signups TO vantage_marketing;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM vantage_marketing;
GRANT SELECT, INSERT, UPDATE ON waitlist_signups TO vantage_marketing;

CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION is_org_member(candidate_org_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE org_id = candidate_org_id AND user_id = current_app_user_id()
  )
$$;
CREATE OR REPLACE FUNCTION has_org_role(candidate_org_id uuid, allowed org_role[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE org_id = candidate_org_id
      AND user_id = current_app_user_id()
      AND role = ANY(allowed)
  )
$$;
CREATE OR REPLACE FUNCTION is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = current_app_user_id())
$$;
REVOKE ALL ON FUNCTION current_app_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION is_org_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION has_org_role(uuid, org_role[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_app_user_id(), is_org_member(uuid),
  has_org_role(uuid, org_role[]), is_platform_admin() TO vantage_app;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_active_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_llm_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE events_ref ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_windows ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self_read ON users FOR SELECT TO vantage_app
  USING (id = current_app_user_id());
CREATE POLICY users_auth_store ON users FOR ALL TO vantage_auth USING (true) WITH CHECK (true);
CREATE POLICY sessions_auth_store ON sessions FOR ALL TO vantage_auth USING (true) WITH CHECK (true);
CREATE POLICY accounts_auth_store ON accounts FOR ALL TO vantage_auth USING (true) WITH CHECK (true);
CREATE POLICY verifications_auth_store ON verifications FOR ALL TO vantage_auth USING (true) WITH CHECK (true);
CREATE POLICY profiles_self ON profiles TO vantage_app
  USING (user_id = current_app_user_id()) WITH CHECK (user_id = current_app_user_id());
CREATE POLICY platform_admins_self_read ON platform_admins FOR SELECT TO vantage_app
  USING (user_id = current_app_user_id());
CREATE POLICY organizations_member_read ON organizations FOR SELECT TO vantage_app
  USING (is_org_member(id));
CREATE POLICY memberships_org_read ON memberships FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY memberships_admin_write ON memberships FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY invites_member_read ON invites FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY invites_admin_write ON invites FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY notifications_self ON notifications TO vantage_app
  USING (user_id = current_app_user_id()) WITH CHECK (user_id = current_app_user_id());
CREATE POLICY context_member_read ON org_active_context FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY context_admin_write ON org_active_context FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY billing_member_read ON org_billing FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY billing_admin_write ON org_billing FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY keys_admin ON org_llm_keys TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY usage_member_read ON ai_usage_events FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY usage_member_insert ON ai_usage_events FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());
CREATE POLICY grants_member_read ON ai_credit_grants FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY admin_actions_admin_read ON admin_actions FOR SELECT TO vantage_app USING (is_platform_admin());
CREATE POLICY events_authenticated_read ON events_ref FOR SELECT TO vantage_app USING (current_app_user_id() IS NOT NULL);
CREATE POLICY windows_authenticated_read ON season_windows FOR SELECT TO vantage_app USING (current_app_user_id() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON users, profiles, organizations, memberships, invites,
  notifications, org_active_context, org_llm_keys TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, accounts, verifications TO vantage_auth;
GRANT SELECT ON platform_admins, admin_actions, org_billing, ai_credit_grants, events_ref,
  season_windows TO vantage_app;
GRANT SELECT, INSERT ON ai_usage_events TO vantage_app;
GRANT UPDATE ON org_billing TO vantage_app;
