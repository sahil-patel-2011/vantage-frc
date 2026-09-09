-- "Is this a spare?" is not a kind of part.
--
-- 0037 put 'spare' in the same CHECK list as 'motor', 'gearbox', 'wheel',
-- 'electronics', 'battery' — so an item could be a gearbox OR a spare, never
-- both. Spare Forecast and Spare Robot Kit then read `WHERE category = 'spare'`,
-- which means a team that files its backup gearbox under 'gearbox' (the obvious
-- thing to do, and what the Inventory category picker invites) has an empty
-- spare forecast and cannot tell why. Meanwhile /spares reads `kind =
-- 'consumable'` — a different axis entirely — so the product has two surfaces
-- with "spare" in the name that share a table and can never share a row:
-- 'spare' is not in the consumable taxonomy, and no consumable category is
-- 'spare'. They were guaranteed disjoint by construction.
--
-- The orthogonal fact gets its own column. `is_spare` says "this is held as a
-- replacement"; `category` keeps saying what the thing actually is; `kind`
-- keeps saying part vs consumable. A spare gearbox is
-- (kind='part', category='gearbox', is_spare=true). A box of spare pneumatic
-- fittings the team keeps for the competition kit is
-- (kind='consumable', category='pneumatics', is_spare=true) — and now appears
-- in the same forecast, which is the point.
--
-- Backfilled from `category = 'spare'`, so every team's forecast reads exactly
-- as it did the moment this lands, and only widens as items get marked.
-- 'spare' stays a legal category for the rows already using it; writers keep it
-- implying is_spare so the two can never disagree.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS is_spare boolean NOT NULL DEFAULT false;

UPDATE inventory_items
   SET is_spare = true
 WHERE category = 'spare'
   AND is_spare = false;

-- Spare Forecast / Spare Robot Kit scan one org's spares; the partial index keeps
-- that off a full org scan without paying for the false rows.
CREATE INDEX IF NOT EXISTS inventory_items_org_spare_idx
  ON inventory_items(org_id, archived)
  WHERE is_spare;

COMMENT ON COLUMN inventory_items.is_spare IS
  'Held as a replacement. Orthogonal to kind (part/consumable) and category (what the thing is).';
