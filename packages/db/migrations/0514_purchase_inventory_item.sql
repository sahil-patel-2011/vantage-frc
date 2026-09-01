-- Optional catalog link on purchase requests. receive-to-inventory writes
-- stock against this inventory_item_id when a request is marked received.
-- NULL skips the ledger and leaves the receive itself alone. Deleting a
-- catalog row clears the link (SET NULL) so the purchase request is preserved.

ALTER TABLE purchase_requests
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS purchase_requests_org_inventory_item_idx
  ON purchase_requests(org_id, inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

COMMENT ON COLUMN purchase_requests.inventory_item_id IS
  'Optional inventory catalog item this purchase restocks. NULL skips receive-to-inventory stock writes.';
