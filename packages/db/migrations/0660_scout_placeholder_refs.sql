-- Let a scout record a robot the reference tables have never heard of.
--
-- match_scout_entries.match_key and .team_key are foreign keys into matches_ref
-- and teams_ref, which only the ingest worker writes. That is correct for a
-- synced district event and wrong everywhere else: at an offseason there is no
-- schedule to sync, on the first morning of any event the schedule has not
-- landed yet, and pit scouting has always offered a free team-number box that
-- fails on any team TBA has not given us. In each case the entry saves on the
-- device and then dies at sync with a constraint violation, which is the worst
-- possible outcome — the scout believes the data is recorded.
--
-- Teams and match numbers are public facts about a competition, not private
-- data, so a placeholder row carries nothing worth isolating. The ingest worker
-- upserts by key, so a real TBA sync later overwrites the placeholder with the
-- real thing: this is self-healing rather than something to reconcile by hand.

-- Placeholders are marked so they can be told apart from synced rows, both by
-- the ingest worker and by anything that wants to say "this came from a scout,
-- not from TBA".
ALTER TABLE teams_ref ADD COLUMN IF NOT EXISTS placeholder boolean NOT NULL DEFAULT false;
ALTER TABLE matches_ref ADD COLUMN IF NOT EXISTS placeholder boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN teams_ref.placeholder IS
  'True for a row created because someone scouted this team before TBA gave us one.';
COMMENT ON COLUMN matches_ref.placeholder IS
  'True for a row created because someone scouted this match before TBA gave us one.';

-- A member may add a placeholder, and only a placeholder. The WITH CHECK is the
-- whole guarantee: without placeholder = true, this would be a hole through
-- which any signed-in user could rewrite shared reference data.
CREATE POLICY teams_ref_scout_placeholder_insert ON teams_ref FOR INSERT TO vantage_app
  WITH CHECK (
    current_app_user_id() IS NOT NULL
    AND placeholder = true
    AND team_key ~ '^frc[1-9][0-9]{0,4}[A-H]?$'
  );

CREATE POLICY matches_ref_scout_placeholder_insert ON matches_ref FOR INSERT TO vantage_app
  WITH CHECK (
    current_app_user_id() IS NOT NULL
    AND placeholder = true
    AND comp_level IN ('qm','qf','sf','f')
    AND match_number BETWEEN 1 AND 999
  );

-- Deliberately no UPDATE or DELETE policy. A member may bring a row into
-- existence so their scouting has somewhere to point; they may not edit or
-- remove shared reference data, including their own placeholders. Correcting a
-- row is the ingest worker's job.
GRANT INSERT ON teams_ref, matches_ref TO vantage_app;
