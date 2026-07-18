-- Allow practice roll-call events alongside meeting/build/competition/outreach.
-- Idempotent: safe if 0047 already applied with the original kind check.

ALTER TABLE attendance_events DROP CONSTRAINT IF EXISTS attendance_events_kind_check;
ALTER TABLE attendance_events ADD CONSTRAINT attendance_events_kind_check
  CHECK (kind IN ('meeting', 'build', 'practice', 'competition', 'outreach', 'other'));
