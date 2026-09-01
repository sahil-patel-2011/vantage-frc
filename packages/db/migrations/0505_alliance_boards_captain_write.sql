-- Widen alliance_boards INSERT/UPDATE so a draft-day captain can mirror Pick Clock
-- slots onto the jsonb desk. 0033 locked writes to owner+admin; pick_list_entries
-- (0454) already accept any org member, so a scout captain's spine write succeeds
-- and the jsonb mirror fails RLS.
--
-- org_role (0000_foundation / packages/db/src/schema.ts) is:
--   owner, admin, scout, viewer
-- No later migration adds a value. There is no captain, drive_team, or mentor
-- label. This file reads pg_enum at apply time and does NOT invent roles.
--
-- Write roles (INSERT/UPDATE only):
--   1. If a drive-team / captain-capable label exists, grant those plus owner
--      and admin (when those labels exist).
--      Recognised labels: captain, scout_captain, drive_team, drive-team,
--      driveteam, drive_team_captain.
--   2. Otherwise grant mentor + admin + owner, intersected with labels that
--      actually exist. Today that is owner + admin (mentor is not an org_role).
--
-- Never granted: scout, viewer. Those are the student-wide memberships; adding
-- them would let every student write the draft board.
--
-- DELETE of a board stays owner+admin (same as 0033). Share tokens stay
-- owner+admin. SELECT stays any org member (alliance_boards_member_read).

DO $$
DECLARE
  existing text[];
  captain_capable text[] := ARRAY[
    'captain',
    'scout_captain',
    'drive_team',
    'drive-team',
    'driveteam',
    'drive_team_captain'
  ];
  matched text[];
  write_labels text[];
  write_list text;
  delete_list text;
BEGIN
  SELECT coalesce(array_agg(e.enumlabel), ARRAY[]::text[])
  INTO existing
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'org_role';

  SELECT coalesce(array_agg(label), ARRAY[]::text[])
  INTO matched
  FROM unnest(existing) AS label
  WHERE label = ANY(captain_capable);

  IF cardinality(matched) > 0 THEN
    SELECT coalesce(array_agg(label), ARRAY[]::text[])
    INTO write_labels
    FROM unnest(existing) AS label
    WHERE label = ANY(matched || ARRAY['owner', 'admin']);
  ELSE
    SELECT coalesce(array_agg(label), ARRAY[]::text[])
    INTO write_labels
    FROM unnest(existing) AS label
    WHERE label IN ('mentor', 'admin', 'owner');
  END IF;

  IF cardinality(write_labels) = 0 THEN
    write_labels := ARRAY['owner', 'admin'];
  END IF;

  write_list := (
    SELECT string_agg(quote_literal(label), ',' ORDER BY
      CASE label
        WHEN 'owner' THEN 0
        WHEN 'admin' THEN 1
        WHEN 'mentor' THEN 2
        ELSE 3
      END,
      label)
    FROM unnest(write_labels) AS label
  );

  delete_list := (
    SELECT string_agg(quote_literal(label), ',' ORDER BY
      CASE label WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, label)
    FROM unnest(existing) AS label
    WHERE label IN ('owner', 'admin')
  );
  IF delete_list IS NULL THEN
    delete_list := '''owner'',''admin''';
  END IF;

  DROP POLICY IF EXISTS alliance_boards_coach_write ON alliance_boards;
  DROP POLICY IF EXISTS alliance_boards_captain_write ON alliance_boards;
  DROP POLICY IF EXISTS alliance_boards_captain_update ON alliance_boards;
  DROP POLICY IF EXISTS alliance_boards_captain_delete ON alliance_boards;

  EXECUTE format(
    $policy$
      CREATE POLICY alliance_boards_captain_write ON alliance_boards
        FOR INSERT TO vantage_app
        WITH CHECK (has_org_role(org_id, ARRAY[%s]::org_role[]))
    $policy$,
    write_list
  );
  EXECUTE format(
    $policy$
      CREATE POLICY alliance_boards_captain_update ON alliance_boards
        FOR UPDATE TO vantage_app
        USING (has_org_role(org_id, ARRAY[%s]::org_role[]))
        WITH CHECK (has_org_role(org_id, ARRAY[%s]::org_role[]))
    $policy$,
    write_list,
    write_list
  );
  EXECUTE format(
    $policy$
      CREATE POLICY alliance_boards_captain_delete ON alliance_boards
        FOR DELETE TO vantage_app
        USING (has_org_role(org_id, ARRAY[%s]::org_role[]))
    $policy$,
    delete_list
  );
END $$;
