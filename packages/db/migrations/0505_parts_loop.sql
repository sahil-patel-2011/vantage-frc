-- ONE PARTS LEDGER, LOOPS CLOSED (0505)
--
-- 0462_parts_unify.sql made inventory_items + inventory_transactions the one stock spine, but
-- three surfaces still touched parts without telling it:
--   * FMEA (fmea_failures) — a logged failure that ate a spare never decremented the bin.
--     inventory_item_id + parts_consumed_qty record WHICH bin and HOW MANY, and the API consumes
--     through lib/parts/store.consumeForSource(sourceKind='fmea', sourceId=failure id) so a
--     replay cannot double-decrement (0462 partial UNIQUE on the ledger).
--   * Reservations — the spare kit / a staged pit repair "holds" parts before they leave the
--     shelf. Until now the only numbers were on-hand and reorder level, so two surfaces could
--     both count the same spare as available. inventory_reservations is a small, org-scoped
--     hold ledger: held -> consumed | released. lib/parts/compute-parts.ts derives
--     available = on-hand - held, and unallocated = available - BOM need.
--   * Print farm — a finished print of a stocked part never landed in inventory. cad_document_id
--     names the CAD source of a job; finish-job now receives the job's quantity onto the linked
--     inventory item through the parts store (sourceKind='print_farm_job', idempotent).

-- ---------------------------------------------------------------- FMEA -> parts

ALTER TABLE fmea_failures
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parts_consumed_qty numeric(12, 2) NOT NULL DEFAULT 0 CHECK (parts_consumed_qty >= 0);

CREATE INDEX IF NOT EXISTS fmea_failures_inventory_item_idx
  ON fmea_failures(org_id, inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

COMMENT ON COLUMN fmea_failures.inventory_item_id IS
  'Spare bin this failure consumed from, if any. Consumption goes through inventory_transactions (source_kind=fmea).';
COMMENT ON COLUMN fmea_failures.parts_consumed_qty IS
  'Quantity of inventory_item_id consumed by this failure. 0 when no part was used.';

-- ---------------------------------------------------------------- reservations (holds)

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity numeric(12, 2) NOT NULL CHECK (quantity > 0),
  source_kind text NOT NULL
    CHECK (source_kind IN ('spare_robot_kit', 'pit_repair_triage', 'bom', 'manual')),
  source_id uuid,
  status text NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'consumed', 'released')),
  note text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_reservations_org_item_idx
  ON inventory_reservations(org_id, item_id, status);
CREATE INDEX IF NOT EXISTS inventory_reservations_source_idx
  ON inventory_reservations(org_id, source_kind, source_id)
  WHERE source_id IS NOT NULL;

COMMENT ON TABLE inventory_reservations IS
  'Holds against unified stock. Only status=held reduces available quantity; consumed/released rows are history.';

ALTER TABLE inventory_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_reservations_member_read ON inventory_reservations
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY inventory_reservations_member_insert ON inventory_reservations
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY inventory_reservations_member_update ON inventory_reservations
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY inventory_reservations_delete ON inventory_reservations
  FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_reservations TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------- print farm -> CAD + parts

ALTER TABLE print_farm_jobs
  ADD COLUMN IF NOT EXISTS cad_document_id uuid REFERENCES cad_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS print_farm_jobs_cad_document_idx
  ON print_farm_jobs(org_id, cad_document_id)
  WHERE cad_document_id IS NOT NULL;

COMMENT ON COLUMN print_farm_jobs.cad_document_id IS
  'CAD vault document this job prints from (0474 cad_documents). Optional; finish-job receives onto inventory_item_id.';
