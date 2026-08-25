-- ONE PARTS LEDGER — collapse the parallel quantity stores onto a single spine.
--
-- Before this migration a team's physical stock lived in three unreconciled places:
--   * inventory_items.quantity + inventory_transactions (0037) — the ORIGINAL spine: catalog rows
--     with an append-only stock-movement ledger, min_quantity reorder thresholds, locations, BOM.
--     Read by Inventory, Spare Forecast (category='spare'), Spare Robot Kit, Pit Repair Triage
--     (spare candidates), Bin/Shelf Locator, AI insights, unified search.
--   * consumables.on_hand (0133) — the /spares page's fasteners/wire/tape counts. Bare quantity
--     column, bare UPDATEs, NO ledger, its own reorder_point. Nothing else could read it, so
--     consumable burn was invisible to BOM coverage, low-stock rollups and forecasts.
--   * spares_available snapshots (0210 pit_repair_triage_reports) — a copy of the matched spare's
--     quantity frozen at triage time. Resolving a repair that consumed the part never decremented
--     anything, so the forecast and the next triage read stale stock.
--
-- inventory_items + inventory_transactions is the spine because it is the only store that already
-- has the append-only ledger, RLS policies, reorder thresholds and every downstream reader.
-- This migration:
--   * adds a kind discriminator ('part' | 'consumable') so consumables keep their own page,
--   * widens the category vocabulary to admit the consumable taxonomy unchanged,
--   * gives the ledger a source reference (source_kind + source_id) so a consumption can name the
--     event that caused it (e.g. a pit-repair resolution) exactly once (partial UNIQUE guard),
--   * BACKFILLS consumables into the spine idempotently (legacy_consumable_id UNIQUE guard) with
--     an opening-balance ledger row per migrated count.
--
-- The consumables table is DELIBERATELY NOT DROPPED — it stays readable for one release so an
-- in-flight deploy can roll back. A follow-up migration should drop it once no build reads it.

-- ---------------------------------------------------------------- spine: inventory_items

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'part',
  ADD COLUMN IF NOT EXISTS legacy_consumable_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_kind_check') THEN
    ALTER TABLE inventory_items
      ADD CONSTRAINT inventory_items_kind_check CHECK (kind IN ('part', 'consumable'));
  END IF;
END $$;

-- 0037's inline category CHECK only knew the parts taxonomy. Recreate it as the union of both
-- vocabularies so backfilled consumables keep their categories verbatim (no lossy remap).
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_category_check;
ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_category_check CHECK (category IN (
    -- parts (0037)
    'motor', 'gearbox', 'wheel', 'electronics', 'pneumatics', 'hardware', 'raw_stock',
    'tool', 'battery', 'spare', 'other',
    -- consumables (0133)
    'fasteners', 'electrical', 'adhesives', 'stock', 'tools', 'ppe'
  ));

-- Idempotent-backfill guard: each consumables row lands on the spine at most once.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_legacy_consumable_uq
  ON inventory_items(legacy_consumable_id) WHERE legacy_consumable_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_items_org_kind_idx ON inventory_items(org_id, kind, archived);

-- ---------------------------------------------------------------- spine: inventory_transactions
--
-- Source reference: which event caused this movement ('pit_repair_triage', 'consumables_backfill',
-- …). The partial UNIQUE makes consumption idempotent — resolving the same repair twice cannot
-- decrement the same item twice.

ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS source_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_source_check') THEN
    ALTER TABLE inventory_transactions
      ADD CONSTRAINT inventory_transactions_source_check
      CHECK ((source_kind IS NULL) = (source_id IS NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_transactions_source_uq
  ON inventory_transactions(item_id, source_kind, source_id)
  WHERE source_kind IS NOT NULL AND source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_transactions_source_idx
  ON inventory_transactions(org_id, source_kind, source_id)
  WHERE source_kind IS NOT NULL;

-- ================================================================ BACKFILL
-- Re-runnable: the legacy_consumable_id / source guards skip rows already carried over.

-- 1. Each consumable becomes a spine item (kind='consumable'). reorder_point -> min_quantity,
--    preferred_vendor -> vendor, on_hand -> quantity. Category carries over verbatim.
INSERT INTO inventory_items (
  org_id, name, category, kind, unit, quantity, min_quantity, vendor, notes,
  created_by, created_at, updated_at, legacy_consumable_id
)
SELECT c.org_id, c.name, c.category, 'consumable', c.unit, c.on_hand, c.reorder_point,
       c.preferred_vendor, coalesce(c.notes, ''), c.created_by, c.created_at, c.updated_at, c.id
FROM consumables c
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_items i WHERE i.legacy_consumable_id = c.id
);

-- 2. Opening-balance ledger row per migrated non-zero count, so the ledger's net equals the
--    quantity column from day one. Sourced so re-running cannot double it.
INSERT INTO inventory_transactions (
  org_id, item_id, delta, reason, note, created_by, created_at, source_kind, source_id
)
SELECT i.org_id, i.id, i.quantity, 'received', 'Opening balance migrated from consumables',
       i.created_by, i.created_at, 'consumables_backfill', i.legacy_consumable_id
FROM inventory_items i
WHERE i.legacy_consumable_id IS NOT NULL
  AND i.quantity <> 0
  AND NOT EXISTS (
    SELECT 1 FROM inventory_transactions t
    WHERE t.item_id = i.id AND t.source_kind = 'consumables_backfill' AND t.source_id = i.legacy_consumable_id
  );
