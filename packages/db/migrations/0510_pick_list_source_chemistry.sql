-- Allow pick_lists.source = 'chemistry'.
--
-- 0454_picklist_unify.sql locked the source CHECK to
-- ('manual', 'picklist_collab', 'alliance_desk', 'strategy', 'intel_research').
-- Chemistry promote therefore stamped source 'strategy' when it minted a new
-- list — the only allowed label that was even close. A list born from partner-fit
-- is not a Strategy write. This adds 'chemistry' so a NEW list created from
-- /chemistry is labeled honestly. Existing event lists are still joined, not
-- replaced. 0502–0509 are reserved.

ALTER TABLE pick_lists
  DROP CONSTRAINT IF EXISTS pick_lists_source_check;

ALTER TABLE pick_lists
  ADD CONSTRAINT pick_lists_source_check
  CHECK (source IN (
    'manual',
    'picklist_collab',
    'alliance_desk',
    'strategy',
    'intel_research',
    'chemistry'
  ));
