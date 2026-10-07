-- Existing accounts have already used the app; never replay their walkthrough
-- when adding account-level tracking. Only accounts created after this migration
-- begin with a NULL first-run marker.
ALTER TABLE profiles ADD COLUMN app_tour_seen_at timestamptz;
UPDATE profiles SET app_tour_seen_at=now();
