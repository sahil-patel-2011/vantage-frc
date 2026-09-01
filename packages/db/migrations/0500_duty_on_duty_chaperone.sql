-- Widen duty_assignments so /duties can persist on-duty mentor and chaperone
-- slots that My Day reads. Empty until a member is assigned — no seeds.

DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'duty_assignments'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE duty_assignments DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE duty_assignments
  ADD CONSTRAINT duty_assignments_kind_check
  CHECK (kind IN (
    'scouting',
    'pit',
    'drive_team',
    'outreach',
    'on_duty',
    'chaperone'
  ));

ALTER TABLE duty_assignments
  ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';

ALTER TABLE duty_assignments
  ADD COLUMN IF NOT EXISTS location_note text NOT NULL DEFAULT '';

COMMENT ON COLUMN duty_assignments.phone IS
  'Contact number for an on-duty or chaperone slot. Empty for other duty kinds.';

COMMENT ON COLUMN duty_assignments.location_note IS
  'Where the on-duty adult can be found (pit, hotel lobby). Empty until posted.';
