-- Dreaming polish: weekly roll-ups + a visible team journal.
--
-- 0446 gave every nightly run exactly one ledger row per (org, day). Two things
-- that ledger cannot express yet:
--
--   1. A WEEKLY roll-up rides along with Saturday's nightly run and writes its
--      own team_memories row. It shares the Saturday `day`, so UNIQUE(org_id,
--      day) has to widen to include a run kind.
--   2. The "Team journal" surface (AI → Memory) shows each night as a dated
--      entry with chips for what fed it — N messages, N scout entries, N tasks
--      done. Those counts exist only inside the digest at run time; without a
--      column the UI would have to re-read every source table (or, worse,
--      parse them back out of the recap prose). One jsonb snapshot per run
--      keeps the journal honest and cheap.
--
-- No new table, no new policy: team_dream_runs already carries org-scoped RLS
-- (member SELECT via is_org_member, writes worker-only) and the table-level
-- grants cover added columns.

ALTER TABLE team_dream_runs
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'daily'
    CHECK (kind IN ('daily', 'weekly'));

-- Counts snapshotted from the digest that produced this run: a flat
-- { "messages": 12, "scouting": 40, "hours": 6.5, ... } object holding only
-- sources that actually contributed. Absent key == that source recorded
-- nothing; the journal renders no chip for it rather than a zero.
ALTER TABLE team_dream_runs
  ADD COLUMN IF NOT EXISTS source_counts jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE team_dream_runs
  ADD CONSTRAINT team_dream_runs_source_counts_is_object
    CHECK (jsonb_typeof(source_counts) = 'object');

-- Widen the daily uniqueness to (org, day, kind) so Saturday can hold both its
-- nightly row and the week roll-up. The inline UNIQUE(org_id, day) from 0446
-- is named team_dream_runs_org_id_day_key by Postgres.
ALTER TABLE team_dream_runs
  DROP CONSTRAINT IF EXISTS team_dream_runs_org_id_day_key;
ALTER TABLE team_dream_runs
  ADD CONSTRAINT team_dream_runs_org_day_kind_key UNIQUE (org_id, day, kind);

-- The journal pages backwards through the season one kind at a time.
CREATE INDEX IF NOT EXISTS team_dream_runs_org_kind_day_idx
  ON team_dream_runs (org_id, kind, day DESC);
