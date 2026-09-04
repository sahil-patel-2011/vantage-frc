-- Join links + attached https links on team calendar events and team todos.
-- Lets a team schedule meetings (Meet / Zoom / any https) and keep a sheet-style
-- work list with Google Doc / Onshape / Drive URLs — never invented rows.

ALTER TABLE subteam_calendar_events
  ADD COLUMN IF NOT EXISTS meeting_url text NOT NULL DEFAULT '';

ALTER TABLE subteam_calendar_events
  ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE team_todos
  ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subteam_calendar_events_meeting_url_len'
  ) THEN
    ALTER TABLE subteam_calendar_events
      ADD CONSTRAINT subteam_calendar_events_meeting_url_len
      CHECK (char_length(meeting_url) <= 500);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subteam_calendar_events_links_array'
  ) THEN
    ALTER TABLE subteam_calendar_events
      ADD CONSTRAINT subteam_calendar_events_links_array
      CHECK (jsonb_typeof(links) = 'array');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_todos_links_array'
  ) THEN
    ALTER TABLE team_todos
      ADD CONSTRAINT team_todos_links_array
      CHECK (jsonb_typeof(links) = 'array');
  END IF;
END $$;

COMMENT ON COLUMN subteam_calendar_events.meeting_url IS
  'Optional https join URL (Meet / Zoom / Teams / Discord). Empty when the meeting is in person.';
COMMENT ON COLUMN subteam_calendar_events.links IS
  'Attached https links [{label, url}] — docs, CAD, sheets. Never invented.';
COMMENT ON COLUMN team_todos.links IS
  'Attached https links [{label, url}] on a team todo row.';
