CREATE TABLE team_provisioning_jobs (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','failed','ready')),
  phase text NOT NULL DEFAULT 'team' CHECK(phase IN ('team','workspace','sheets','tools','recovery','verify','ready')),
  completed_phases text[] NOT NULL DEFAULT ARRAY['team']::text[],
  resources jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  workflow_run_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz
);
ALTER TABLE team_provisioning_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY provisioning_member_read ON team_provisioning_jobs FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY provisioning_owner_write ON team_provisioning_jobs FOR ALL TO vantage_app
  USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
  WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));
GRANT SELECT, INSERT, UPDATE ON team_provisioning_jobs TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_provisioning_jobs TO vantage_worker;
CREATE POLICY provisioning_worker ON team_provisioning_jobs TO vantage_worker USING(true) WITH CHECK(true);

CREATE OR REPLACE FUNCTION account_age_eligible(candidate_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT NOT EXISTS(SELECT 1 FROM profiles WHERE user_id=candidate_user AND date_of_birth > (CURRENT_DATE - interval '13 years')::date)
$$;
REVOKE ALL ON FUNCTION account_age_eligible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_age_eligible(uuid) TO vantage_app,vantage_worker,vantage_auth,vantage_pairing;
CREATE OR REPLACE FUNCTION is_org_member(candidate_org_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT account_age_eligible(current_app_user_id()) AND EXISTS(
    SELECT 1 FROM memberships WHERE org_id=candidate_org_id AND user_id=current_app_user_id())
$$;
CREATE OR REPLACE FUNCTION has_org_role(candidate_org_id uuid, allowed org_role[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT account_age_eligible(current_app_user_id()) AND EXISTS(
    SELECT 1 FROM memberships WHERE org_id=candidate_org_id AND user_id=current_app_user_id() AND role=ANY(allowed))
$$;
CREATE OR REPLACE FUNCTION enforce_member_age() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT account_age_eligible(NEW.user_id) THEN RAISE EXCEPTION 'Vantage accounts are available to people age 13 and older'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER memberships_age BEFORE INSERT OR UPDATE OF user_id ON memberships FOR EACH ROW EXECUTE FUNCTION enforce_member_age();
