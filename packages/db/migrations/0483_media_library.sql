-- Media Library: real photo/video storage for the whole team.
-- Items live EITHER in the org's database rows (storage_location='db', bytes
-- bytea, 0046-style sha256 checksum) OR on a paired team storage node
-- (storage_location='node', metadata-only row whose bytes are fetched through
-- the storage-node proxy; node_item_id points at the node's copy).
-- Thumbnails are always small in-database jpegs: photos are canvas-downscaled
-- client-side, video posters are captured client-side from a <video> frame —
-- no server transcoding exists or is implied.

CREATE TABLE media_albums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  event_key text CHECK (event_key IS NULL OR char_length(event_key) BETWEEN 1 AND 40),
  cover_item_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE media_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL REFERENCES users(id),
  album_id uuid REFERENCES media_albums(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('photo','video')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  caption text CHECK (caption IS NULL OR char_length(caption) <= 2000),
  taken_at timestamptz,
  event_key text CHECK (event_key IS NULL OR char_length(event_key) BETWEEN 1 AND 40),
  subteam text CHECK (subteam IS NULL OR char_length(subteam) BETWEEN 1 AND 60),
  storage_location text NOT NULL DEFAULT 'db' CHECK (storage_location IN ('db','node')),
  node_item_id text CHECK (node_item_id IS NULL OR char_length(node_item_id) BETWEEN 1 AND 200),
  content_type text NOT NULL CHECK (content_type IN
    ('image/jpeg','image/png','image/webp','video/mp4','video/webm')),
  -- NULL while a 'db' upload is pending its byte PUT, and always NULL for
  -- 'node' items (the node holds the bytes).
  bytes bytea,
  byte_size bigint NOT NULL CHECK (byte_size >= 1),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  width integer CHECK (width IS NULL OR width BETWEEN 1 AND 16384),
  height integer CHECK (height IS NULL OR height BETWEEN 1 AND 16384),
  duration_seconds real CHECK (duration_seconds IS NULL OR (duration_seconds > 0 AND duration_seconds <= 21600)),
  thumbnail bytea,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, sha256),
  -- kind must agree with the container format.
  CHECK (
    (kind = 'photo' AND content_type IN ('image/jpeg','image/png','image/webp'))
    OR (kind = 'video' AND content_type IN ('video/mp4','video/webm'))
  ),
  -- node rows are metadata-only; db rows never carry a node pointer.
  CHECK (
    (storage_location = 'db' AND node_item_id IS NULL)
    OR (storage_location = 'node' AND node_item_id IS NOT NULL AND bytes IS NULL)
  ),
  -- a 'ready' db item must actually hold its bytes.
  CHECK (status <> 'ready' OR storage_location <> 'db' OR bytes IS NOT NULL),
  -- honest db-storage caps: ~8MB photos (post client downscale), ~100MB video.
  -- Bigger videos belong on a storage node or a YouTube link.
  CHECK (
    storage_location <> 'db'
    OR (kind = 'photo' AND byte_size <= 8388608)
    OR (kind = 'video' AND byte_size <= 104857600)
  )
);

ALTER TABLE media_albums
  ADD CONSTRAINT media_albums_cover_item_fk
  FOREIGN KEY (cover_item_id) REFERENCES media_items(id) ON DELETE SET NULL;

CREATE INDEX media_items_org_created_idx ON media_items(org_id, created_at DESC);
CREATE INDEX media_items_org_album_idx ON media_items(org_id, album_id, created_at DESC);
CREATE INDEX media_items_org_event_idx ON media_items(org_id, event_key) WHERE event_key IS NOT NULL;
CREATE INDEX media_albums_org_idx ON media_albums(org_id, created_at DESC);

ALTER TABLE media_albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_items ENABLE ROW LEVEL SECURITY;

-- Albums: every member can read and create; the creator or an owner/admin
-- can rename or delete.
CREATE POLICY media_albums_member_read ON media_albums FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY media_albums_member_insert ON media_albums FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY media_albums_owner_update ON media_albums FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)
    AND (created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])))
  WITH CHECK (is_org_member(org_id));
CREATE POLICY media_albums_owner_delete ON media_albums FOR DELETE TO vantage_app
  USING (is_org_member(org_id)
    AND (created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])));

-- Items: every member can read and upload; the uploader or an owner/admin
-- can edit metadata or delete.
CREATE POLICY media_items_member_read ON media_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY media_items_member_insert ON media_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND uploader_id = current_app_user_id());
CREATE POLICY media_items_uploader_update ON media_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)
    AND (uploader_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])))
  WITH CHECK (is_org_member(org_id));
CREATE POLICY media_items_uploader_delete ON media_items FOR DELETE TO vantage_app
  USING (is_org_member(org_id)
    AND (uploader_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])));

GRANT SELECT, INSERT, UPDATE, DELETE ON media_albums, media_items TO vantage_app, vantage_worker;
