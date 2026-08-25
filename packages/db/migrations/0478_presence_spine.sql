-- Presence spine: RSVP -> roll call -> hours as ONE record.
--
-- Today a team answers "who is coming tonight" from subteam_calendar_rsvps (0147),
-- "who was here" from attendance_entries (0047), and "how many hours" from
-- hour_logs (0051). Those three stores share no key, so the same Tuesday produces
-- three unrelated answers and nobody can see that four people who said "going"
-- never showed.
--
-- COMPATIBILITY PROMISE — attendance_entries stays free-text-capable.
--   attendance_entries.person_name remains NOT NULL and remains the display label.
--   The new user_id column is NULLABLE and ON DELETE SET NULL, so:
--     * every existing row keeps working untouched (user_id NULL = "not linked yet");
--     * a roll call taken on paper for a parent volunteer who has no account is
--       still a legal row forever;
--     * deleting a user account never deletes the attendance history — the row
--       falls back to the name that was typed.
--   Nothing in this migration back-fills user_id. Linking a name to a member is an
--   explicit human confirmation (see apps/web/lib/presence/match-names.ts), never a
--   fuzzy guess run by a job.
--
-- OCCURRENCE IDENTITY. 0456_calendar_recurrence.sql made a calendar event either a
-- series master (rrule set, occurrences expanded at read time) or a concrete row.
-- Presence therefore keys on (calendar_event_id, occurrence_date) — the local
-- calendar date of the occurrence in the series' recurrence_timezone — never on
-- event_id alone, which would collapse fourteen Tuesdays into one row.

-- ---------------------------------------------------------------------------
-- (a) Attendance entries gain an OPTIONAL member identity.
-- ---------------------------------------------------------------------------

ALTER TABLE attendance_entries
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN attendance_entries.user_id IS
  'Optional confirmed link to a member account. NULL = unlinked free-text roll call (still valid). person_name stays the display label.';

CREATE INDEX IF NOT EXISTS attendance_entries_user_idx
  ON attendance_entries(org_id, user_id)
  WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- (b) Hour logs gain an OPTIONAL calendar occurrence.
-- ---------------------------------------------------------------------------

ALTER TABLE hour_logs
  ADD COLUMN IF NOT EXISTS calendar_event_id uuid REFERENCES subteam_calendar_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS occurrence_date date;

COMMENT ON COLUMN hour_logs.calendar_event_id IS
  'Optional link to the calendar event this shop session belongs to. NULL = unattached session (drop-in work), which stays valid.';
COMMENT ON COLUMN hour_logs.occurrence_date IS
  'Local date of the linked occurrence (series-timezone). Required alongside calendar_event_id to disambiguate a recurring series.';

CREATE INDEX IF NOT EXISTS hour_logs_calendar_event_idx
  ON hour_logs(org_id, calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- (c) The reconciled presence record.
--
-- One row per (member, occurrence). Every column is nullable on purpose:
--   rsvp NULL      = this member never responded. NOT "no".
--   attended NULL  = no roll call was taken for them. NOT "absent".
--   minutes NULL   = no clocked time. NOT "zero hours".
-- A member with no signal at all has NO ROW. Absence is never inferred, and a
-- row is only ever written by an explicit action (a person confirming), never by
-- a background sweep guessing from an RSVP.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS presence_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calendar_event_id uuid NOT NULL REFERENCES subteam_calendar_events(id) ON DELETE CASCADE,
  -- Local date of the occurrence in the series' recurrence_timezone.
  occurrence_date date NOT NULL,
  rsvp text CHECK (rsvp IS NULL OR rsvp IN ('going', 'maybe', 'no')),
  attended boolean,
  hour_log_id uuid REFERENCES hour_logs(id) ON DELETE SET NULL,
  minutes numeric(7, 2) CHECK (minutes IS NULL OR minutes >= 0),
  -- Which surface produced this reconciliation.
  source text NOT NULL CHECK (source IN ('rsvp', 'roll_call', 'kiosk', 'manual')),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, calendar_event_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS presence_records_occurrence_idx
  ON presence_records(org_id, calendar_event_id, occurrence_date);
CREATE INDEX IF NOT EXISTS presence_records_member_idx
  ON presence_records(org_id, user_id, occurrence_date DESC);

ALTER TABLE presence_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS presence_records_read ON presence_records;
DROP POLICY IF EXISTS presence_records_insert ON presence_records;
DROP POLICY IF EXISTS presence_records_update ON presence_records;
DROP POLICY IF EXISTS presence_records_delete ON presence_records;

-- Presence is team-visible (the same transparency the calendar and hour logs
-- already have). Writes stamp the author; owners/admins may correct anyone's row.
CREATE POLICY presence_records_read ON presence_records
  FOR SELECT TO vantage_app USING (is_org_member(org_id));

CREATE POLICY presence_records_insert ON presence_records
  FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND (
      recorded_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

CREATE POLICY presence_records_update ON presence_records
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (
    is_org_member(org_id)
    AND (
      recorded_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

CREATE POLICY presence_records_delete ON presence_records
  FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON presence_records TO vantage_app, vantage_worker;
