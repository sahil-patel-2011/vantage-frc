-- Pit photos become a first-class, offline-safe object.
--
-- scout_media gains the server-normalized shape (EXIF-oriented WebP full +
-- 320px thumb, dimensions, sha256 over the normalized full), the linkage key
-- the offline outbox already knows (entry_client_id — the entry's clientId,
-- resolved to entry_id when the entry syncs), and soft delete. A per-org
-- quota table caps how much pit media one team can park in the database.

ALTER TABLE scout_media
  ADD COLUMN IF NOT EXISTS thumb_bytes bytea,
  ADD COLUMN IF NOT EXISTS thumb_content_type text,
  ADD COLUMN IF NOT EXISTS thumb_width integer,
  ADD COLUMN IF NOT EXISTS thumb_height integer,
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS checksum_sha256 text,
  ADD COLUMN IF NOT EXISTS entry_client_id text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);

ALTER TABLE scout_media
  ADD CONSTRAINT scout_media_checksum_format_ck
  CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE scout_media
  ADD CONSTRAINT scout_media_dimensions_ck
  CHECK (
    (width IS NULL OR width BETWEEN 1 AND 16384)
    AND (height IS NULL OR height BETWEEN 1 AND 16384)
    AND (thumb_width IS NULL OR thumb_width BETWEEN 1 AND 4096)
    AND (thumb_height IS NULL OR thumb_height BETWEEN 1 AND 4096)
  );

COMMENT ON COLUMN scout_media.thumb_bytes IS
  'Server-generated 320px WebP thumbnail of the normalized photo (NULL for video/audio).';
COMMENT ON COLUMN scout_media.checksum_sha256 IS
  'sha256 of the normalized full bytes — dedupes retakes per (org, event, team).';
COMMENT ON COLUMN scout_media.entry_client_id IS
  'Offline clientId of the scout entry this media belongs to; resolved to entry_id on entry sync.';
COMMENT ON COLUMN scout_media.deleted_at IS
  'Soft delete: bytes and thumb are NULLed, the row stays for audit and dedupe history.';

-- Live-row lookups: by synced entry, by not-yet-synced entry, by pit subject.
CREATE INDEX IF NOT EXISTS scout_media_org_entry_live_idx
  ON scout_media(org_id, entry_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS scout_media_org_entry_client_live_idx
  ON scout_media(org_id, entry_client_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS scout_media_org_subject_live_idx
  ON scout_media(org_id, event_key, team_key) WHERE deleted_at IS NULL;

-- One copy of a given photo per (org, event, team). Retakes that normalize to
-- identical bytes collapse onto the existing row; the PUT handler answers
-- {duplicate:true} instead of storing twice.
CREATE UNIQUE INDEX IF NOT EXISTS scout_media_org_subject_checksum_uq
  ON scout_media(org_id, event_key, team_key, checksum_sha256)
  WHERE checksum_sha256 IS NOT NULL AND deleted_at IS NULL;

-- Per-org pit media quota. Absent row = defaults (2000 items / 2 GiB).
CREATE TABLE scout_media_quota (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  max_items integer NOT NULL DEFAULT 2000 CHECK (max_items >= 0),
  max_bytes bigint NOT NULL DEFAULT 2147483648 CHECK (max_bytes >= 0),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scout_media_quota ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_media_quota_member_read ON scout_media_quota FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_media_quota_coach_insert ON scout_media_quota FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY scout_media_quota_coach_update ON scout_media_quota FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY scout_media_quota_coach_delete ON scout_media_quota FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

-- The capturer (or an owner/admin) may remove a photo. Soft delete is an
-- UPDATE (already covered by scout_media_author_update with the same
-- predicate); the hard DELETE is used to drop a pending row that turned out
-- to be a byte-identical duplicate.
CREATE POLICY scout_media_author_delete ON scout_media FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (captured_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  );

GRANT DELETE ON scout_media TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scout_media_quota TO vantage_app, vantage_worker;
