-- Discord cross-post flag for team announcements.
-- 0124_team_announcements.sql already created team_announcements (+ reads/acks).
-- This migration only adds the Discord field the /team/announcements API expects.

ALTER TABLE team_announcements
  ADD COLUMN IF NOT EXISTS posted_to_discord boolean NOT NULL DEFAULT false;

GRANT SELECT, INSERT, UPDATE, DELETE ON team_announcements TO vantage_app, vantage_worker;
