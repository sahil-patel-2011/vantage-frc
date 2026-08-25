-- Team Library: the team's shared shelf. Members upload ANY file type
-- (STEP/STP, DXF, F3D, SLDPRT, PDFs, manuals, images, zips, code — no
-- format allowlist, just a size cap and an empty-file rejection), organize
-- them in nestable folders, add external links as first-class resources,
-- and attach related links (vendor page, manufacturer manual) to a file.
--
-- Storage follows the media-library pattern (0483): bytes live EITHER in
-- the org's database rows (storage_location='db', bytea + 0046-style sha256
-- checksum, two-phase pending->ready upload) OR on a paired team storage
-- node (0484; storage_location='node', metadata-only row whose bytes are
-- fetched through the storage-node proxy).
--
-- Sharing scopes are enforced in RLS, not just UI: every folder/resource is
-- team-wide (visibility='team', default) or restricted. Restricted rows are
-- visible only to their creator, explicitly granted members
-- (library_resource_grants / library_folder_grants), and org owners/admins.

CREATE TABLE library_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES library_folders(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  visibility text NOT NULL DEFAULT 'team' CHECK (visibility IN ('team','restricted')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX library_folders_org_parent_idx ON library_folders(org_id, parent_id);
-- Same-name siblings are confusing on a shared shelf. The zero-uuid sentinel
-- folds NULL parents in, so root-level names are unique too.
CREATE UNIQUE INDEX library_folders_sibling_name_idx
  ON library_folders(org_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- Cycle guard. SECURITY DEFINER on purpose: the walk must see the WHOLE
-- parent chain, including restricted folders the mover cannot SELECT —
-- otherwise a hidden intermediate folder would let a cycle slip past an
-- RLS-scoped check. It reads only parent pointers and leaks nothing.
CREATE OR REPLACE FUNCTION library_folder_no_cycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ancestor uuid := NEW.parent_id; hops int := 0;
BEGIN
  WHILE ancestor IS NOT NULL LOOP
    IF ancestor = NEW.id THEN
      RAISE EXCEPTION 'Moving this folder inside itself would create a loop';
    END IF;
    hops := hops + 1;
    IF hops > 100 THEN
      RAISE EXCEPTION 'Folder nesting is too deep (max 100 levels)';
    END IF;
    SELECT parent_id INTO ancestor FROM library_folders WHERE id = ancestor;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER library_folders_no_cycle
  BEFORE INSERT OR UPDATE OF parent_id ON library_folders
  FOR EACH ROW WHEN (NEW.parent_id IS NOT NULL)
  EXECUTE FUNCTION library_folder_no_cycle();

CREATE TABLE library_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Deleting a folder must never destroy files silently: resources fall back
  -- to the library root instead of cascading away.
  folder_id uuid REFERENCES library_folders(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('file','link')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 4000),
  tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 20),
  visibility text NOT NULL DEFAULT 'team' CHECK (visibility IN ('team','restricted')),
  -- link resources
  url text CHECK (url IS NULL OR (char_length(url) <= 2048 AND url ~ '^https?://')),
  -- file resources (no content-type allowlist — any file within the cap)
  file_name text CHECK (file_name IS NULL OR char_length(file_name) BETWEEN 1 AND 255),
  content_type text CHECK (content_type IS NULL
    OR (char_length(content_type) BETWEEN 3 AND 255 AND content_type ~ '^\S+/\S+$')),
  storage_location text CHECK (storage_location IN ('db','node')),
  node_item_id text CHECK (node_item_id IS NULL OR char_length(node_item_id) BETWEEN 1 AND 200),
  -- NULL while a 'db' upload is pending its byte PUT, and always NULL for
  -- 'node' items (the node holds the bytes).
  bytes bytea,
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 1),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('pending','ready')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Links carry a URL and never bytes; files carry file metadata and never a URL.
  CHECK (
    (kind = 'link' AND url IS NOT NULL AND file_name IS NULL AND bytes IS NULL
      AND byte_size IS NULL AND sha256 IS NULL AND storage_location IS NULL
      AND node_item_id IS NULL AND status = 'ready')
    OR (kind = 'file' AND url IS NULL AND file_name IS NOT NULL AND content_type IS NOT NULL
      AND storage_location IS NOT NULL AND byte_size IS NOT NULL AND sha256 IS NOT NULL)
  ),
  -- node rows are metadata-only; db rows never carry a node pointer (0483 pattern).
  CHECK (
    kind = 'link'
    OR (storage_location = 'db' AND node_item_id IS NULL)
    OR (storage_location = 'node' AND node_item_id IS NOT NULL AND bytes IS NULL)
  ),
  -- a 'ready' db file must actually hold its bytes.
  CHECK (kind = 'link' OR status <> 'ready' OR storage_location <> 'db' OR bytes IS NOT NULL),
  -- honest db-storage cap: 100 MB per file. Bigger files belong on a paired
  -- storage node (0484).
  CHECK (kind = 'link' OR storage_location <> 'db' OR byte_size <= 104857600)
);

CREATE INDEX library_resources_org_created_idx ON library_resources(org_id, created_at DESC);
CREATE INDEX library_resources_org_folder_idx ON library_resources(org_id, folder_id, created_at DESC);
CREATE INDEX library_resources_org_sha_idx ON library_resources(org_id, sha256) WHERE sha256 IS NOT NULL;

-- Related links attached to a resource (the vendor page for a STEP file).
CREATE TABLE library_resource_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES library_resources(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  url text NOT NULL CHECK (char_length(url) <= 2048 AND url ~ '^https?://'),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX library_resource_links_resource_idx ON library_resource_links(resource_id);

-- Explicit member grants for restricted items. org_id is denormalized so the
-- grant policies stay self-contained (no join back to the parent table, which
-- would recurse with the parent's SELECT policy).
CREATE TABLE library_resource_grants (
  resource_id uuid NOT NULL REFERENCES library_resources(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_id, user_id)
);

CREATE INDEX library_resource_grants_user_idx ON library_resource_grants(org_id, user_id);

CREATE TABLE library_folder_grants (
  folder_id uuid NOT NULL REFERENCES library_folders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, user_id)
);

CREATE INDEX library_folder_grants_user_idx ON library_folder_grants(org_id, user_id);

ALTER TABLE library_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_resource_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_resource_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_folder_grants ENABLE ROW LEVEL SECURITY;

-- Grant rows: SELECT is deliberately self-contained (subject, granter, or
-- owner/admin) so the parent tables' SELECT policies can reference these
-- tables without policy recursion.
CREATE POLICY library_resource_grants_read ON library_resource_grants FOR SELECT TO vantage_app
  USING (is_org_member(org_id)
    AND (user_id = current_app_user_id()
      OR granted_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])));
-- Only the resource's creator or an owner/admin may share it, and only with
-- members of the same org.
CREATE POLICY library_resource_grants_insert ON library_resource_grants FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id)
    AND granted_by = current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM memberships ms
      WHERE ms.org_id = library_resource_grants.org_id
        AND ms.user_id = library_resource_grants.user_id)
    AND EXISTS (
      SELECT 1 FROM library_resources r
      WHERE r.id = library_resource_grants.resource_id
        AND r.org_id = library_resource_grants.org_id
        AND (r.created_by = current_app_user_id()
          OR has_org_role(r.org_id, ARRAY['owner','admin']::org_role[]))));
CREATE POLICY library_resource_grants_delete ON library_resource_grants FOR DELETE TO vantage_app
  USING (is_org_member(org_id)
    AND (granted_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])
      OR EXISTS (
        SELECT 1 FROM library_resources r
        WHERE r.id = library_resource_grants.resource_id
          AND r.created_by = current_app_user_id())));

CREATE POLICY library_folder_grants_read ON library_folder_grants FOR SELECT TO vantage_app
  USING (is_org_member(org_id)
    AND (user_id = current_app_user_id()
      OR granted_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])));
CREATE POLICY library_folder_grants_insert ON library_folder_grants FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id)
    AND granted_by = current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM memberships ms
      WHERE ms.org_id = library_folder_grants.org_id
        AND ms.user_id = library_folder_grants.user_id)
    AND EXISTS (
      SELECT 1 FROM library_folders f
      WHERE f.id = library_folder_grants.folder_id
        AND f.org_id = library_folder_grants.org_id
        AND (f.created_by = current_app_user_id()
          OR has_org_role(f.org_id, ARRAY['owner','admin']::org_role[]))));
CREATE POLICY library_folder_grants_delete ON library_folder_grants FOR DELETE TO vantage_app
  USING (is_org_member(org_id)
    AND (granted_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])
      OR EXISTS (
        SELECT 1 FROM library_folders f
        WHERE f.id = library_folder_grants.folder_id
          AND f.created_by = current_app_user_id())));

-- Folders: team-wide rows are visible to every member; restricted rows only
-- to creator + granted members + owners/admins. This is THE sharing model —
-- the UI merely reflects it.
CREATE POLICY library_folders_visible_read ON library_folders FOR SELECT TO vantage_app
  USING (is_org_member(org_id) AND (
    visibility = 'team'
    OR created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    OR EXISTS (
      SELECT 1 FROM library_folder_grants g
      WHERE g.folder_id = library_folders.id AND g.user_id = current_app_user_id())));
-- Creating inside a parent requires the parent to be visible to the creator.
CREATE POLICY library_folders_member_insert ON library_folders FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id)
    AND created_by = current_app_user_id()
    AND (parent_id IS NULL OR EXISTS (
      SELECT 1 FROM library_folders p
      WHERE p.id = library_folders.parent_id AND p.org_id = library_folders.org_id)));
CREATE POLICY library_folders_owner_update ON library_folders FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)
    AND (created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])))
  WITH CHECK (is_org_member(org_id)
    AND (parent_id IS NULL OR EXISTS (
      SELECT 1 FROM library_folders p
      WHERE p.id = library_folders.parent_id AND p.org_id = library_folders.org_id)));
CREATE POLICY library_folders_owner_delete ON library_folders FOR DELETE TO vantage_app
  USING (is_org_member(org_id)
    AND (created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])));

-- Resources: same shape as folders.
CREATE POLICY library_resources_visible_read ON library_resources FOR SELECT TO vantage_app
  USING (is_org_member(org_id) AND (
    visibility = 'team'
    OR created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    OR EXISTS (
      SELECT 1 FROM library_resource_grants g
      WHERE g.resource_id = library_resources.id AND g.user_id = current_app_user_id())));
CREATE POLICY library_resources_member_insert ON library_resources FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id)
    AND created_by = current_app_user_id()
    AND (folder_id IS NULL OR EXISTS (
      SELECT 1 FROM library_folders f
      WHERE f.id = library_resources.folder_id AND f.org_id = library_resources.org_id)));
CREATE POLICY library_resources_owner_update ON library_resources FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)
    AND (created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])))
  WITH CHECK (is_org_member(org_id)
    AND (folder_id IS NULL OR EXISTS (
      SELECT 1 FROM library_folders f
      WHERE f.id = library_resources.folder_id AND f.org_id = library_resources.org_id)));
CREATE POLICY library_resources_owner_delete ON library_resources FOR DELETE TO vantage_app
  USING (is_org_member(org_id)
    AND (created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])));

-- Attached links inherit their parent resource's visibility: the EXISTS runs
-- under the caller's RLS, so a hidden resource hides its links too.
CREATE POLICY library_resource_links_read ON library_resource_links FOR SELECT TO vantage_app
  USING (is_org_member(org_id) AND EXISTS (
    SELECT 1 FROM library_resources r
    WHERE r.id = library_resource_links.resource_id
      AND r.org_id = library_resource_links.org_id));
-- Any member who can SEE a resource may attach a related link to it.
CREATE POLICY library_resource_links_insert ON library_resource_links FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id)
    AND created_by = current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM library_resources r
      WHERE r.id = library_resource_links.resource_id
        AND r.org_id = library_resource_links.org_id));
-- The link's author, the resource's creator, or an owner/admin may remove it.
CREATE POLICY library_resource_links_delete ON library_resource_links FOR DELETE TO vantage_app
  USING (is_org_member(org_id)
    AND (created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])
      OR EXISTS (
        SELECT 1 FROM library_resources r
        WHERE r.id = library_resource_links.resource_id
          AND r.created_by = current_app_user_id())));

-- Request-path role only; no worker job touches the library.
GRANT SELECT, INSERT, UPDATE, DELETE ON library_folders, library_resources TO vantage_app;
GRANT SELECT, INSERT, DELETE ON library_resource_links, library_resource_grants, library_folder_grants TO vantage_app;
