-- Scouting leads can delete a scout report.
--
-- Saved entries has shown owners and admins a Delete button on every report,
-- and every tap failed: 0003 granted the app role SELECT, INSERT and UPDATE on
-- the two report tables and no DELETE, and there was no DELETE policy, so the
-- lead read a raw "permission denied" message instead.
--
-- Deleting stays narrow:
--   * only an owner or admin of the report's own team (the same rule the app
--     checks before it deletes);
--   * the phone's sync receipt for that report goes with it, or a resend of
--     the same report would be answered "already saved" against a row that no
--     longer exists (same owner/admin rule);
--   * child rows (field checks, pick influence, cross-checks, pit signals)
--     already cascade, and a disagreement that named the report as its winner
--     already sets that to NULL.

GRANT DELETE ON match_scout_entries, pit_scout_entries, scout_sync_receipts TO vantage_app;

DROP POLICY IF EXISTS match_entries_lead_delete ON match_scout_entries;
CREATE POLICY match_entries_lead_delete ON match_scout_entries FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

DROP POLICY IF EXISTS pit_entries_lead_delete ON pit_scout_entries;
CREATE POLICY pit_entries_lead_delete ON pit_scout_entries FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

DROP POLICY IF EXISTS receipts_lead_delete ON scout_sync_receipts;
CREATE POLICY receipts_lead_delete ON scout_sync_receipts FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
