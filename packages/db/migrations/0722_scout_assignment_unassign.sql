-- A scouting lead can take an assignment back.
--
-- scout_assignments (0003) granted vantage_app SELECT, INSERT and UPDATE only, so the
-- Assignments board could hand a scout a robot but never remove one: a lead who assigned the
-- wrong robot had no way to undo it, and the robot stayed on the scout's list (and counted
-- against them as "missed") until someone edited the database by hand.
--
-- Row access is unchanged. assignments_coach_write (0711) is FOR ALL and already limits
-- every write, DELETE included, to can_manage_scouting(org_id) — owners, admins and delegated
-- scouting leads of that team. The 0715 View only guard view_only_no_delete is a restrictive
-- policy on this table and keeps refusing View only members. Only the privilege was missing.

GRANT DELETE ON scout_assignments TO vantage_app;
