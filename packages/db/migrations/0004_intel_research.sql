CREATE TYPE research_trigger AS ENUM ('scheduled', 'on_demand', 'event_locked');
CREATE TYPE research_status AS ENUM ('queued', 'running', 'completed', 'failed', 'skipped');
CREATE TYPE research_source_type AS ENUM ('cd_post', 'social', 'news', 'reveal_video', 'team_site', 'other');

CREATE TABLE research_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id),
  team_key text NOT NULL REFERENCES teams_ref(team_key) ON DELETE CASCADE,
  event_key text REFERENCES events_ref(event_key),
  trigger research_trigger NOT NULL,
  status research_status NOT NULL DEFAULT 'queued',
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  search_queries integer NOT NULL DEFAULT 0 CHECK (search_queries >= 0),
  result_count integer NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_jobs_queue_idx ON research_jobs(status, scheduled_for);
CREATE INDEX research_jobs_team_idx ON research_jobs(team_key, created_at);

CREATE TABLE research_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_key text NOT NULL REFERENCES teams_ref(team_key) ON DELETE CASCADE,
  source_url text NOT NULL,
  canonical_url text NOT NULL,
  source_type research_source_type NOT NULL,
  source_title text,
  summary text NOT NULL,
  sentiment double precision,
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  extracted_facts jsonb NOT NULL DEFAULT '[]',
  content_hash text NOT NULL,
  published_at timestamptz,
  found_at timestamptz NOT NULL DEFAULT now(),
  research_job_id uuid NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  UNIQUE(team_key, canonical_url, content_hash)
);
CREATE INDEX research_findings_team_found_idx ON research_findings(team_key, found_at);

CREATE TABLE pick_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, event_key, name)
);
CREATE TABLE pick_list_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_list_id uuid NOT NULL REFERENCES pick_lists(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  rank integer NOT NULL CHECK(rank > 0),
  tier text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pick_list_id, team_key),
  UNIQUE(pick_list_id, rank)
);
CREATE TABLE team_reliability (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  event_key text NOT NULL REFERENCES events_ref(event_key),
  sample_size integer NOT NULL,
  consistency_score double precision,
  reliability_score double precision,
  evidence jsonb NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id, team_key, event_key)
);
CREATE TABLE foul_profiles (
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  event_key text NOT NULL REFERENCES events_ref(event_key),
  sample_size integer NOT NULL,
  foul_rate double precision,
  risk text NOT NULL,
  notes text,
  evidence jsonb NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(team_key, event_key)
);

ALTER TABLE research_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pick_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE pick_list_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_reliability ENABLE ROW LEVEL SECURITY;
ALTER TABLE foul_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY research_jobs_member_read ON research_jobs FOR SELECT TO vantage_app
  USING (org_id IS NULL OR is_org_member(org_id));
CREATE POLICY research_jobs_member_insert ON research_jobs FOR INSERT TO vantage_app
  WITH CHECK (org_id IS NOT NULL AND is_org_member(org_id) AND requested_by = current_app_user_id() AND trigger = 'on_demand');
CREATE POLICY research_findings_authenticated_read ON research_findings FOR SELECT TO vantage_app
  USING (current_app_user_id() IS NOT NULL);
CREATE POLICY pick_lists_member_read ON pick_lists FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY pick_lists_coach_write ON pick_lists FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND created_by = current_app_user_id());
CREATE POLICY pick_entries_member_read ON pick_list_entries FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY pick_entries_coach_write ON pick_list_entries FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY reliability_member_read ON team_reliability FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY reliability_member_write ON team_reliability FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin','scout']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin','scout']::org_role[]));
CREATE POLICY foul_profiles_authenticated_read ON foul_profiles FOR SELECT TO vantage_app
  USING (current_app_user_id() IS NOT NULL);

GRANT SELECT, INSERT ON research_jobs TO vantage_app;
GRANT SELECT ON research_findings, foul_profiles TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pick_lists, pick_list_entries, team_reliability TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON research_jobs, research_findings, pick_lists,
  pick_list_entries, team_reliability, foul_profiles TO vantage_worker;
CREATE TYPE research_trigger AS ENUM ('scheduled', 'on_demand', 'event_locked');
CREATE TYPE research_status AS ENUM ('queued', 'running', 'completed', 'failed', 'skipped');
CREATE TYPE research_source_type AS ENUM ('cd_post', 'social', 'news', 'reveal_video', 'team_site', 'other');

CREATE TABLE research_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id),
  team_key text NOT NULL REFERENCES teams_ref(team_key) ON DELETE CASCADE,
  event_key text REFERENCES events_ref(event_key),
  trigger research_trigger NOT NULL,
  status research_status NOT NULL DEFAULT 'queued',
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  search_queries integer NOT NULL DEFAULT 0 CHECK (search_queries >= 0),
  result_count integer NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_jobs_queue_idx ON research_jobs(status, scheduled_for);
CREATE INDEX research_jobs_team_idx ON research_jobs(team_key, created_at);

CREATE TABLE research_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_key text NOT NULL REFERENCES teams_ref(team_key) ON DELETE CASCADE,
  source_url text NOT NULL,
  canonical_url text NOT NULL,
  source_type research_source_type NOT NULL,
  source_title text,
  summary text NOT NULL,
  sentiment double precision,
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  extracted_facts jsonb NOT NULL DEFAULT '[]',
  content_hash text NOT NULL,
  published_at timestamptz,
  found_at timestamptz NOT NULL DEFAULT now(),
  research_job_id uuid NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  UNIQUE (team_key, canonical_url, content_hash)
);
CREATE INDEX research_findings_team_found_idx ON research_findings(team_key, found_at);

CREATE TABLE pick_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_key, name)
);
CREATE TABLE pick_list_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_list_id uuid NOT NULL REFERENCES pick_lists(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  rank integer NOT NULL CHECK (rank > 0),
  tier text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pick_list_id, team_key),
  UNIQUE (pick_list_id, rank)
);
CREATE TABLE team_reliability (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  event_key text NOT NULL REFERENCES events_ref(event_key),
  sample_size integer NOT NULL CHECK (sample_size >= 0),
  consistency_score double precision,
  reliability_score double precision,
  evidence jsonb NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, team_key, event_key)
);
CREATE TABLE foul_profiles (
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  event_key text NOT NULL REFERENCES events_ref(event_key),
  sample_size integer NOT NULL CHECK (sample_size >= 0),
  foul_rate double precision,
  risk text NOT NULL,
  notes text,
  evidence jsonb NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_key, event_key)
);

ALTER TABLE research_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pick_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE pick_list_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_reliability ENABLE ROW LEVEL SECURITY;
ALTER TABLE foul_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY research_jobs_member_read ON research_jobs FOR SELECT TO vantage_app
  USING (org_id IS NULL OR is_org_member(org_id));
CREATE POLICY research_jobs_on_demand_insert ON research_jobs FOR INSERT TO vantage_app
  WITH CHECK (
    org_id IS NOT NULL AND is_org_member(org_id) AND requested_by = current_app_user_id()
    AND trigger = 'on_demand'
  );
CREATE POLICY research_findings_authenticated_read ON research_findings FOR SELECT TO vantage_app
  USING (current_app_user_id() IS NOT NULL);
CREATE POLICY pick_lists_member_read ON pick_lists FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY pick_lists_coach_write ON pick_lists FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND created_by = current_app_user_id());
CREATE POLICY pick_entries_member_read ON pick_list_entries FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY pick_entries_coach_write ON pick_list_entries FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY reliability_member_read ON team_reliability FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY reliability_member_write ON team_reliability FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin','scout']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin','scout']::org_role[]));
CREATE POLICY foul_profiles_authenticated_read ON foul_profiles FOR SELECT TO vantage_app
  USING (current_app_user_id() IS NOT NULL);

GRANT SELECT, INSERT ON research_jobs TO vantage_app;
GRANT SELECT ON research_findings, foul_profiles TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON pick_lists, pick_list_entries, team_reliability TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON research_jobs, research_findings, pick_lists,
  pick_list_entries, team_reliability, foul_profiles TO vantage_worker;
