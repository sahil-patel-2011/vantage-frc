-- pEPA snapshots could never be written.
--
-- `scout_sample` is declared integer, but the value the compute layer produces is a
-- quality-weighted sample size — 3.4 org scout observations, not 3. Every insert threw
-- `invalid input syntax for type integer: "3.4"`, the catch around the loop swallowed
-- it, and because withRls runs the request in one transaction the pit-signal and
-- live-alert writes that follow died with "current transaction is aborted" too.
--
-- Visible effect: Strategy computed a correct blended pEPA and then discarded it, so
-- /api/org/analytics/private-epa, the pick desk's pEPA column, and the
-- `strategy.private_edge` agent tool were permanently empty no matter how much a team
-- scouted.
--
-- The stored value should carry the weighting the model actually used, so widen the
-- column rather than rounding the signal away at the call site.

ALTER TABLE private_epa_snapshots
  ALTER COLUMN scout_sample TYPE numeric(8, 2) USING scout_sample::numeric(8, 2);
