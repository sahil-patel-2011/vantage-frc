-- Per-member Tesla-style cockpit knobs. A short list only — never a settings maze.
-- Shape is validated in apps/web/lib/cockpit/prefs.ts; the column is object-typed
-- so unknown keys cannot break the write path.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS cockpit_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_cockpit_prefs_shape;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_cockpit_prefs_shape
  CHECK (jsonb_typeof(cockpit_prefs) = 'object');

COMMENT ON COLUMN profiles.cockpit_prefs IS
  'Small personal cockpit: confirm writes, pause live polls when hidden, Bugbot instructions, include tests, default Bugbot mode.';
