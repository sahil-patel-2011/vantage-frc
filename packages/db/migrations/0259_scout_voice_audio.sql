-- Voice STT offline outbox: queue audio captures + transcripts with scout media sync.
ALTER TYPE scout_media_kind ADD VALUE IF NOT EXISTS 'audio';

ALTER TABLE scout_media
  ADD COLUMN IF NOT EXISTS transcript text;
