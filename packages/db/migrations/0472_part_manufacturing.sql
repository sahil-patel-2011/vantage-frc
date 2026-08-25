-- Part Manufacturing kanban: track a physical part through the shop from
-- 'needs_design' to 'done' (CAM, cutting, finishing, scrap/remake).
--
-- BOUNDARY — this is deliberately NOT a duplicate of the existing spines:
--   * inventory_items (0037/0462) is STOCK ON HAND — how many of a thing the team owns.
--     manufacturing_parts tracks the act of MAKING a part; no stock is decremented here
--     (consumption stays with the inventory ledger; a manufacturing row may LINK to the
--     inventory_items row it will become via inventory_item_id).
--   * build_tasks (0044) is GENERAL BUILD WORK (todo/in_progress/done engineering tasks).
--     manufacturing_parts is a machine-shop state machine (CAM, cut, finish) per physical
--     part; a row may link back to the build task it serves via build_task_id.
--   * bom_entries (0037) is the DESIGN LIST — what a subsystem needs on paper.
--     manufacturing_parts is the shop-floor reality of producing those entries; the
--     optional bom_entry_id link lets a BOM row seed a manufacturing card, never the
--     other way around.
--
-- manufacturing_state_events is the append-only history behind the board — one row per
-- state move so cycle-time is computable from real timestamps, never editable after the
-- fact (no UPDATE/DELETE policy or grant for the app role).

CREATE TABLE manufacturing_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  part_name text NOT NULL CHECK (char_length(part_name) BETWEEN 1 AND 160),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  method text NOT NULL DEFAULT 'other'
    CHECK (method IN ('mill','lathe','router','waterjet','laser','3d_print','bandsaw','sheet_bend','cots','assembly','other')),
  state text NOT NULL DEFAULT 'needs_design'
    CHECK (state IN ('needs_design','needs_cam','ready_to_cut','in_progress','needs_finishing','done','scrapped')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','critical')),
  subsystem_id uuid REFERENCES robot_subsystems(id) ON DELETE SET NULL,
  bom_entry_id uuid REFERENCES bom_entries(id) ON DELETE SET NULL,
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  build_task_id uuid REFERENCES build_tasks(id) ON DELETE SET NULL,
  material text,
  stock_note text,
  needed_by date,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES users(id),
  scrap_reason text,
  reprint_of_id uuid REFERENCES manufacturing_parts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX manufacturing_parts_board_idx
  ON manufacturing_parts(org_id, state, priority, needed_by);
CREATE INDEX manufacturing_parts_open_due_idx
  ON manufacturing_parts(org_id, needed_by)
  WHERE state NOT IN ('done','scrapped');

-- Append-only state history. from_state is NULL for the creation event.
CREATE TABLE manufacturing_state_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  part_id uuid NOT NULL REFERENCES manufacturing_parts(id) ON DELETE CASCADE,
  from_state text
    CHECK (from_state IS NULL OR from_state IN ('needs_design','needs_cam','ready_to_cut','in_progress','needs_finishing','done','scrapped')),
  to_state text NOT NULL
    CHECK (to_state IN ('needs_design','needs_cam','ready_to_cut','in_progress','needs_finishing','done','scrapped')),
  note text,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX manufacturing_state_events_part_idx
  ON manufacturing_state_events(part_id, created_at);
CREATE INDEX manufacturing_state_events_org_idx
  ON manufacturing_state_events(org_id, created_at DESC);

ALTER TABLE manufacturing_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturing_state_events ENABLE ROW LEVEL SECURITY;

-- The whole shop drives the board: members read and update; inserts stamp the requester;
-- destructive deletes are limited to the requester or an owner/admin.
CREATE POLICY manufacturing_parts_read ON manufacturing_parts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY manufacturing_parts_insert ON manufacturing_parts FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND requested_by = current_app_user_id());
CREATE POLICY manufacturing_parts_update ON manufacturing_parts FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY manufacturing_parts_delete ON manufacturing_parts FOR DELETE TO vantage_app
  USING (requested_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

-- History is insert-only for the app role — no UPDATE/DELETE policy or grant, so the
-- kanban's past cannot be rewritten. The worker role keeps full access for maintenance.
CREATE POLICY manufacturing_state_events_read ON manufacturing_state_events FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY manufacturing_state_events_insert ON manufacturing_state_events FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND actor_user_id = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON manufacturing_parts TO vantage_app, vantage_worker;
GRANT SELECT, INSERT ON manufacturing_state_events TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON manufacturing_state_events TO vantage_worker;
