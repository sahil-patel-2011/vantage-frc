-- Meeting agenda/minutes persist against a real calendar meeting
-- (subteam_calendar_events.kind = 'meeting'). The event id used to live inside
-- agenda_items jsonb as calendarEventId; that is not queryable and is easy to
-- drop. This migration adds a dedicated nullable FK and backfills from jsonb.
-- Rows with no matching calendar event stay NULL — empty until a meeting exists.
-- Minutes stay whatever the human wrote; nothing here invents DEMO notes.

ALTER TABLE meeting_autopilot_agendas
  ADD COLUMN IF NOT EXISTS calendar_event_id uuid REFERENCES subteam_calendar_events(id) ON DELETE SET NULL;

COMMENT ON COLUMN meeting_autopilot_agendas.calendar_event_id IS
  'Calendar event this agenda/minutes row is persisted against. NULL = unlinked legacy row or no meeting yet.';

-- Copy jsonb calendarEventId only when the event still exists in the same org.
UPDATE meeting_autopilot_agendas a
SET calendar_event_id = e.id
FROM subteam_calendar_events e
WHERE a.calendar_event_id IS NULL
  AND jsonb_typeof(a.agenda_items) = 'object'
  AND a.agenda_items->>'calendarEventId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND e.id = (a.agenda_items->>'calendarEventId')::uuid
  AND e.org_id = a.org_id;

-- Drop the duplicated jsonb key only after a successful column backfill so an
-- unmatched id is not lost.
UPDATE meeting_autopilot_agendas
SET agenda_items = agenda_items - 'calendarEventId'
WHERE calendar_event_id IS NOT NULL
  AND jsonb_typeof(agenda_items) = 'object'
  AND agenda_items ? 'calendarEventId';

CREATE INDEX IF NOT EXISTS meeting_autopilot_agendas_calendar_event_idx
  ON meeting_autopilot_agendas(org_id, calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;
