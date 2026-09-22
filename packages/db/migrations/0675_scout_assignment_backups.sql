-- Backup scouts and event-scoped assignment reads.
--
-- No CHECK on scout_assignments.role. The column has always been free text and
-- real rows already hold more than two values: the lineup writes 'primary',
-- the trust auto-assigner writes 'primary-fatigue-cap', and publishing a shift
-- plan writes the station ('Red 2'). Constraining it to primary/backup would
-- reject rows the app writes today. The convention is documented instead: the
-- exact value 'backup' marks a backup (scouts only if the primary misses);
-- anything else is a primary duty.
--
-- The index is what the timeline, coverage and accountability reads need. They
-- all filter by (org_id, event_key) and join by match/team; the only index
-- until now led with (org_id, user_id), so every one of those reads walked the
-- team's assignments from every event it has ever attended.

CREATE INDEX IF NOT EXISTS scout_assignments_org_event_match_idx
  ON scout_assignments (org_id, event_key, match_key, team_key);

COMMENT ON COLUMN scout_assignments.role IS
  'Free text. Exactly ''backup'' marks a backup scout, expected to scout only if the primary misses. Any other value (''primary'', a station such as ''Red 2'', ''primary-fatigue-cap'') is a primary duty.';
