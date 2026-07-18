-- Remote-join links on season milestones.
-- A milestone (typically kind='meeting') can carry a Zoom / Google Meet / Teams /
-- any-https URL so members find the join link in the team hub instead of hunting
-- through chat. Validated app-side (https-only) in lib/season-calendar.

ALTER TABLE season_milestones ADD COLUMN IF NOT EXISTS meeting_url text;
