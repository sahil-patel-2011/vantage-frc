-- "Your apps": one list of pinned places, up to eight.
--
-- profiles.island_tabs (0354) holds exactly the four bottom-bar apps. The same pins now also
-- fill the top row of the phone menu and the Pinned group at the top of the desktop sidebar,
-- so a person can pin up to eight places (the bottom bar shows the first four).
--
-- pinned_apps is that list. NULL means "never edited here": the app reads island_tabs as it
-- always has (a custom four stays those four; the empty default or the old stock four get the
-- current default pins), and "Reset to default" writes NULL again so the person follows future
-- defaults. island_tabs is kept in step with the first four pins, so older code keeps working.
--
-- The app enforces the limit of eight; the constraint keeps a little headroom so raising it
-- later needs no migration. Row access is unchanged: profiles keeps its own RLS and grants
-- (0001), which cover the new column.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS pinned_apps jsonb;

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_pinned_apps_shape;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_pinned_apps_shape
  CHECK (
    pinned_apps IS NULL
    OR (jsonb_typeof(pinned_apps) = 'array' AND jsonb_array_length(pinned_apps) BETWEEN 1 AND 12)
  );
