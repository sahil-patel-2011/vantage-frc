-- Persist scout media bytes (robot images / pit photos) org-isolated under RLS.
-- storage_key remains org-prefixed (org_id/local/client_id); bytes stay in Neon.

ALTER TABLE scout_media
  ADD COLUMN IF NOT EXISTS bytes bytea;

COMMENT ON COLUMN scout_media.bytes IS
  'Org-isolated binary payload for uploaded scout media (robot images, pit photos).';
