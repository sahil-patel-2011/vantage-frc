-- A practice schedule you can delete.
--
-- The repeat control on the season calendar expands "every Tuesday and
-- Thursday until bag day" into real entries rather than storing a rule. That
-- is the right trade for a team whose schedule changes weekly — every entry
-- can be moved, renamed or cancelled on its own, and nothing else in the
-- feature has to know recurrence exists.
--
-- It left one operation worse than before: undoing it. Forty entries created
-- by one press took forty presses to remove, and there was nothing in the data
-- that said they belonged together.
--
-- This is that one thing: a nullable id shared by the rows one press created.
-- Deliberately not a recurrence rule. It carries no cadence, no end date and
-- no exceptions, so nothing can drift out of sync with the entries — the
-- entries remain the truth, and this only records which press made them.
--
-- NULL for everything that already exists and for every single entry made
-- since, which is most of them. A row leaving its series (moved, renamed) is
-- not special-cased: it keeps the id, because "created together" stays true
-- however the entry is edited afterwards, and a team deleting the series does
-- mean the Tuesday that moved to Wednesday as well.

ALTER TABLE season_milestones ADD COLUMN IF NOT EXISTS series_id uuid;

-- The only query this serves: every row of one series, within one org. Partial
-- because the column is null on the large majority of rows.
CREATE INDEX IF NOT EXISTS season_milestones_series_idx
  ON season_milestones (org_id, series_id)
  WHERE series_id IS NOT NULL;
