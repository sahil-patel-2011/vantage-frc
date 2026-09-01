-- Client-generated pit-photo thumbnail. NULL means the device never produced one
-- (Node/canvas unavailable, video/audio, decode failed). GET ?variant=thumb must
-- then 404 honestly — never a DEMO jpeg and never the 6MB original.

ALTER TABLE scout_media
  ADD COLUMN IF NOT EXISTS thumb_bytes bytea;

COMMENT ON COLUMN scout_media.thumb_bytes IS
  'Client-generated pit-photo thumbnail. NULL = no thumb stored; ?variant=thumb 404s rather than inventing a jpeg or serving bytes.';
