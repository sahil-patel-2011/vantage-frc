-- Optional teammate assignee on a packing master-list row.
-- My Kit reads assigned_user_id = current member. Unassigned rows stay off My Kit
-- (created_by is the list seeder, not an assignment). Empty until a lead assigns.

ALTER TABLE packing_items
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN packing_items.assigned_user_id IS
  'Optional teammate responsible for packing this master-list item. NULL = unassigned (not that member''s kit).';

CREATE INDEX IF NOT EXISTS packing_items_assignee_idx
  ON packing_items(org_id, assigned_user_id)
  WHERE assigned_user_id IS NOT NULL;
