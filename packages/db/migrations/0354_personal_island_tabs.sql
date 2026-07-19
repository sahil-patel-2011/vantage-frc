ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS island_tabs jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_island_tabs_shape;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_island_tabs_shape
  CHECK (jsonb_typeof(island_tabs) = 'array' AND jsonb_array_length(island_tabs) <= 4);
