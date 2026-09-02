-- Engineering notebook entries can carry photos from the media library
-- (0483). This is a link table only: bytes and thumbnails stay in media_items
-- and are served by the existing media-library routes, so the notebook gets
-- images without a second upload pipeline. Deleting the media item or the
-- entry removes the link; the entry text is never touched.

CREATE TABLE IF NOT EXISTS notebook_entry_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES notebook_entries(id) ON DELETE CASCADE,
  media_item_id uuid NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  added_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, media_item_id)
);

CREATE INDEX IF NOT EXISTS notebook_entry_media_entry_idx
  ON notebook_entry_media(org_id, entry_id, position);
CREATE INDEX IF NOT EXISTS notebook_entry_media_item_idx
  ON notebook_entry_media(org_id, media_item_id);

ALTER TABLE notebook_entry_media ENABLE ROW LEVEL SECURITY;

-- Same collaboration model as notebook_entries: every member reads and edits
-- attachments; inserts stamp who attached.
DROP POLICY IF EXISTS notebook_entry_media_read ON notebook_entry_media;
DROP POLICY IF EXISTS notebook_entry_media_insert ON notebook_entry_media;
DROP POLICY IF EXISTS notebook_entry_media_update ON notebook_entry_media;
DROP POLICY IF EXISTS notebook_entry_media_delete ON notebook_entry_media;
CREATE POLICY notebook_entry_media_read ON notebook_entry_media FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY notebook_entry_media_insert ON notebook_entry_media FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND added_by = current_app_user_id());
CREATE POLICY notebook_entry_media_update ON notebook_entry_media FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY notebook_entry_media_delete ON notebook_entry_media FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON notebook_entry_media TO vantage_app, vantage_worker;
