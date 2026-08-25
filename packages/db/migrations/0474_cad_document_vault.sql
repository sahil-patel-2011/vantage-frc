-- CAD/STL document vault: versioned binary CAD files (STL/STEP/vendor formats)
-- stored org-isolated in Postgres bytea so RLS remains the only tenancy mechanism.
-- Documents link optionally to a robot subsystem (0104_robot_subsystems.sql).
--
-- Non-goals (by design, stated honestly in the UI too):
--   * No Onshape/Fusion API calls, OAuth, or geometry authoring — this is a file vault.
--   * No object store — bytes live in these tables behind org_id RLS.
--   * No server-side STEP/IGES tessellation — `geometry` stays '{}'::jsonb for every
--     format except parsed STL; the app never reports volume for a file it did not parse.

CREATE TABLE cad_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description text,
  subsystem_id uuid REFERENCES robot_subsystems(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'part'
    CHECK (kind IN ('part','assembly','drawing','print','vendor','other')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','superseded','archived')),
  current_version integer NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  external_url text CHECK (external_url IS NULL OR external_url ~ '^https://'),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year, title)
);
CREATE INDEX cad_documents_org_season_idx ON cad_documents(org_id, season_year, status);
CREATE INDEX cad_documents_subsystem_idx ON cad_documents(subsystem_id) WHERE subsystem_id IS NOT NULL;

CREATE TABLE cad_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Opaque download handle; never guessable, still org-guarded by RLS on read.
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES cad_documents(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
  format text NOT NULL CHECK (format IN
    ('stl','step','stp','iges','igs','3mf','obj','dxf','pdf','sldprt','sldasm','f3d','ipt','iam','zip')),
  media_type text NOT NULL,
  bytes bytea NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 52428800), -- 50 MB / file
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  -- Org-prefixed key mirrors scout_media (0264): the key itself proves tenancy.
  storage_key text NOT NULL CHECK (storage_key LIKE org_id::text || '/%'),
  -- Populated only for parsed STL (triangle count, bbox, volume, surface area,
  -- degenerate count). '{}' means "not parsed" — the UI must say so, never show zeros.
  geometry jsonb NOT NULL DEFAULT '{}'::jsonb,
  thumbnail_png bytea,
  change_note text,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, document_id, version)
);
CREATE INDEX cad_document_versions_document_idx ON cad_document_versions(document_id, version DESC);
CREATE INDEX cad_document_versions_org_idx ON cad_document_versions(org_id);

ALTER TABLE cad_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE cad_document_versions ENABLE ROW LEVEL SECURITY;

-- Any org member reads and maintains the vault; inserts stamp the author;
-- destructive deletes are limited to owner/admin.
CREATE POLICY cad_documents_member_read ON cad_documents FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY cad_documents_member_insert ON cad_documents FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY cad_documents_member_update ON cad_documents FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY cad_documents_admin_delete ON cad_documents FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY cad_document_versions_member_read ON cad_document_versions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY cad_document_versions_member_insert ON cad_document_versions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND uploaded_by = current_app_user_id());
CREATE POLICY cad_document_versions_member_update ON cad_document_versions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY cad_document_versions_admin_delete ON cad_document_versions FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON cad_documents TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON cad_document_versions TO vantage_app, vantage_worker;
