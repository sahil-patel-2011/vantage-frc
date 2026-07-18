-- Let alumni opt in as mentors so current students can find help. Additive to the
-- team_alumni directory (migration 0113).

ALTER TABLE team_alumni ADD COLUMN IF NOT EXISTS is_mentor boolean NOT NULL DEFAULT false;
ALTER TABLE team_alumni ADD COLUMN IF NOT EXISTS mentor_topic text;
