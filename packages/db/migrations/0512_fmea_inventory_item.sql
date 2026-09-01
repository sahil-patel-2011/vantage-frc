-- Optional spare-bin link on FMEA failures. Spare Forecast prefers this
-- inventory_item_id over the free-text subsystem_name join when both exist.
-- NULL keeps legacy rows matching by subsystem name only. Deleting a bin
-- clears the link (SET NULL) so the failure log is preserved.

ALTER TABLE fmea_failures
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS fmea_failures_org_inventory_item_idx
  ON fmea_failures(org_id, season_year, inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

COMMENT ON COLUMN fmea_failures.inventory_item_id IS
  'Optional inventory spare this failure consumed. NULL falls back to free-text subsystem_name matching.';
