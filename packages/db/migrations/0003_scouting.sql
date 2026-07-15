CREATE TYPE scout_schema_type AS ENUM ('match', 'pit');
CREATE TYPE scout_confidence AS ENUM ('high', 'normal', 'low');
CREATE TYPE scout_source AS ENUM ('manual', 'voice', 'import');
CREATE TYPE scout_media_kind AS ENUM ('photo', 'video');
CREATE TYPE scout_media_status AS ENUM ('pending', 'uploaded', 'failed');
CREATE TYPE disagreement_status AS ENUM ('open', 'resolved', 'dismissed');

CREATE TABLE scout_schemas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year integer NOT NULL,
  type scout_schema_type NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  schema jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, year, type, version)
);

CREATE TABLE match_scout_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  match_key text NOT NULL REFERENCES matches_ref(match_key),
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  scout_user_id uuid NOT NULL REFERENCES users(id),
  schema_id uuid NOT NULL REFERENCES scout_schemas(id),
  payload jsonb NOT NULL,
  confidence scout_confidence NOT NULL DEFAULT 'normal',
  source scout_source NOT NULL DEFAULT 'manual',
  client_id text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, client_id)
);
CREATE INDEX match_scout_entries_subject_idx
  ON match_scout_entries(org_id, event_key, match_key, team_key);

CREATE TABLE pit_scout_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  scout_user_id uuid NOT NULL REFERENCES users(id),
  schema_id uuid NOT NULL REFERENCES scout_schemas(id),
  payload jsonb NOT NULL,
  confidence scout_confidence NOT NULL DEFAULT 'normal',
  source scout_source NOT NULL DEFAULT 'manual',
  client_id text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, client_id)
);
CREATE INDEX pit_scout_entries_subject_idx
  ON pit_scout_entries(org_id, event_key, team_key);

CREATE TABLE scout_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  entry_id uuid,
  client_id text NOT NULL,
  kind scout_media_kind NOT NULL,
  status scout_media_status NOT NULL DEFAULT 'pending',
  storage_key text,
  content_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size >= 0),
  tags text[] NOT NULL DEFAULT '{}',
  captured_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, client_id)
);

CREATE TABLE scout_disagreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  match_key text NOT NULL,
  team_key text NOT NULL,
  field_key text NOT NULL,
  entry_ids uuid[] NOT NULL,
  values jsonb NOT NULL,
  status disagreement_status NOT NULL DEFAULT 'open',
  resolution jsonb,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, match_key, team_key, field_key)
);

CREATE TABLE org_value_formulas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  expression jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE scout_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  match_key text NOT NULL,
  team_key text NOT NULL,
  role text NOT NULL DEFAULT 'primary',
  starts_at timestamptz,
  ends_at timestamptz,
  UNIQUE (org_id, user_id, match_key, team_key)
);

CREATE TABLE scout_sync_receipts (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  entry_type scout_schema_type NOT NULL,
  server_entry_id uuid NOT NULL,
  payload_hash text NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, client_id)
);

ALTER TABLE scout_schemas ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_scout_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE pit_scout_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_disagreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_value_formulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_sync_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_schemas_member_read ON scout_schemas FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_schemas_coach_write ON scout_schemas FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND created_by = current_app_user_id());

CREATE POLICY match_entries_member_read ON match_scout_entries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY match_entries_scout_insert ON match_scout_entries FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin','scout']::org_role[]) AND scout_user_id = current_app_user_id());
CREATE POLICY match_entries_author_update ON match_scout_entries FOR UPDATE TO vantage_app
  USING (scout_user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (is_org_member(org_id));

CREATE POLICY pit_entries_member_read ON pit_scout_entries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY pit_entries_scout_insert ON pit_scout_entries FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin','scout']::org_role[]) AND scout_user_id = current_app_user_id());
CREATE POLICY pit_entries_author_update ON pit_scout_entries FOR UPDATE TO vantage_app
  USING (scout_user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (is_org_member(org_id));

CREATE POLICY scout_media_member_read ON scout_media FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY scout_media_scout_write ON scout_media FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin','scout']::org_role[]) AND captured_by = current_app_user_id());
CREATE POLICY scout_media_author_update ON scout_media FOR UPDATE TO vantage_app
  USING (captured_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY disagreements_member_read ON scout_disagreements FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY disagreements_scout_insert ON scout_disagreements FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin','scout']::org_role[]));
CREATE POLICY disagreements_refresh ON scout_disagreements FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin','scout']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin','scout']::org_role[]));
CREATE POLICY disagreements_coach_review ON scout_disagreements FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY formulas_member_read ON org_value_formulas FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY formulas_coach_write ON org_value_formulas FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY assignments_member_read ON scout_assignments FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY assignments_coach_write ON scout_assignments FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY receipts_member_read ON scout_sync_receipts FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY receipts_scout_insert ON scout_sync_receipts FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin','scout']::org_role[]));
CREATE POLICY receipts_scout_update ON scout_sync_receipts FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin','scout']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin','scout']::org_role[]));

GRANT SELECT, INSERT, UPDATE ON scout_schemas, match_scout_entries, pit_scout_entries,
  scout_media, scout_disagreements, org_value_formulas, scout_assignments,
  scout_sync_receipts TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scout_schemas, match_scout_entries,
  pit_scout_entries, scout_media, scout_disagreements, org_value_formulas,
  scout_assignments, scout_sync_receipts TO vantage_worker;
