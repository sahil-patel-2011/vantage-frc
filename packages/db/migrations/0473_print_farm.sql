-- 3D PRINT FARM: printers, print queue, filament stock, and job -> subsystem links.
--
-- Boundary vs existing tables:
--   * equipment_maintenance_assets (0298) tracks MACHINE UPKEEP (rails greased, belts tensioned).
--     print_farm_printers optionally links to an asset via equipment_asset_id but never duplicates
--     the maintenance schedule.
--   * inventory_items (0037/0462) is the STOCK spine. print_farm_filaments optionally links a spool
--     to a catalog item via inventory_item_id but keeps its own grams_remaining, because a spool is
--     a partially-consumed unit, not a count of identical parts.
--
-- Demand caveat (be honest about why this exists): docs/COMMUNITY_DEMAND_RND.md line 116 puts
-- "3D-print queue management" on the do-not-build list — negative demand findings in two
-- independent research lanes. The owner asked for it anyway. It is therefore deliberately SMALL,
-- HONEST, and MANUAL:
--
-- EXPLICIT NON-GOALS: no slicer integration, no G-code upload, no printer telemetry, and no
-- OctoPrint / Bambu / Prusa Connect API. print_farm_printers.status is HUMAN-REPORTED — the UI
-- must always show it with its status_updated_at timestamp, never imply a live connection.
--
-- print_farm_filament_usage is an APPEND-ONLY ledger: `grams` is a signed delta applied to
-- print_farm_filaments.grams_remaining in the same transaction (negative = consumed by a
-- print/purge/waste, positive = restock/audit correction). No UPDATE or DELETE policy exists on
-- purpose; corrections are new 'audit' rows.

-- ---------------------------------------------------------------- filament spools

CREATE TABLE print_farm_filaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  material text NOT NULL DEFAULT 'pla'
    CHECK (material IN ('pla','petg','abs','asa','tpu','nylon','pc','pa_cf','resin','other')),
  brand text,
  color text,
  diameter_mm numeric(4, 2) CHECK (diameter_mm IS NULL OR diameter_mm > 0),
  spool_grams_total numeric(8, 1) CHECK (spool_grams_total IS NULL OR spool_grams_total > 0),
  grams_remaining numeric(8, 1) NOT NULL DEFAULT 0 CHECK (grams_remaining >= 0),
  unit_cost_usd numeric(10, 2) CHECK (unit_cost_usd IS NULL OR unit_cost_usd >= 0),
  vendor text,
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  location_id uuid REFERENCES bin_shelf_locator_locations(id) ON DELETE SET NULL,
  opened_on date,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX print_farm_filaments_org_idx ON print_farm_filaments(org_id, archived, material);

ALTER TABLE print_farm_filaments ENABLE ROW LEVEL SECURITY;

CREATE POLICY print_farm_filaments_member_read ON print_farm_filaments FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY print_farm_filaments_member_insert ON print_farm_filaments FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY print_farm_filaments_member_update ON print_farm_filaments FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY print_farm_filaments_member_delete ON print_farm_filaments FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON print_farm_filaments TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------- printers

CREATE TABLE print_farm_printers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  model text,
  nozzle_mm numeric(4, 2) CHECK (nozzle_mm IS NULL OR nozzle_mm > 0),
  build_x_mm integer CHECK (build_x_mm IS NULL OR build_x_mm > 0),
  build_y_mm integer CHECK (build_y_mm IS NULL OR build_y_mm > 0),
  build_z_mm integer CHECK (build_z_mm IS NULL OR build_z_mm > 0),
  -- HUMAN-REPORTED status; status_updated_at says how stale the report is.
  status text NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle','printing','paused','maintenance','offline','retired')),
  status_updated_at timestamptz NOT NULL DEFAULT now(),
  equipment_asset_id uuid REFERENCES equipment_maintenance_assets(id) ON DELETE SET NULL,
  loaded_filament_id uuid REFERENCES print_farm_filaments(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
CREATE INDEX print_farm_printers_org_idx ON print_farm_printers(org_id, active, name);

ALTER TABLE print_farm_printers ENABLE ROW LEVEL SECURITY;

CREATE POLICY print_farm_printers_member_read ON print_farm_printers FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY print_farm_printers_member_insert ON print_farm_printers FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY print_farm_printers_member_update ON print_farm_printers FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY print_farm_printers_member_delete ON print_farm_printers FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON print_farm_printers TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------- print queue

CREATE TABLE print_farm_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  part_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  purpose text NOT NULL DEFAULT 'competition_robot'
    CHECK (purpose IN ('competition_robot','practice_robot','prototype','spare','tool','fixture','outreach','other')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','printing','paused','done','failed','cancelled')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','critical')),
  subsystem_id uuid REFERENCES robot_subsystems(id) ON DELETE SET NULL,
  subsystem_name text, -- free-text fallback when no robot_subsystems row exists
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  build_task_id uuid REFERENCES build_tasks(id) ON DELETE SET NULL,
  printer_id uuid REFERENCES print_farm_printers(id) ON DELETE SET NULL,
  filament_id uuid REFERENCES print_farm_filaments(id) ON DELETE SET NULL,
  -- Estimates are HUMAN-ENTERED and nullable. A job without an estimate is excluded from every
  -- ETA computation and flagged needsEstimate in the app — never defaulted.
  estimated_minutes integer CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
  estimated_grams numeric(8, 1) CHECK (estimated_grams IS NULL OR estimated_grams > 0),
  actual_minutes integer CHECK (actual_minutes IS NULL OR actual_minutes >= 0),
  actual_grams numeric(8, 1) CHECK (actual_grams IS NULL OR actual_grams >= 0),
  needed_by date,
  started_at timestamptz,
  finished_at timestamptz,
  failure_reason text
    CHECK (failure_reason IS NULL OR failure_reason IN ('warp','adhesion','clog','filament_out','power','layer_shift','support','other')),
  reprint_of_job_id uuid REFERENCES print_farm_jobs(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES users(id),
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX print_farm_jobs_org_queue_idx ON print_farm_jobs(org_id, status, priority, needed_by);
CREATE INDEX print_farm_jobs_org_printer_idx ON print_farm_jobs(org_id, printer_id, status);
CREATE INDEX print_farm_jobs_org_needed_idx ON print_farm_jobs(org_id, needed_by)
  WHERE status IN ('queued','printing');

ALTER TABLE print_farm_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY print_farm_jobs_member_read ON print_farm_jobs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY print_farm_jobs_member_insert ON print_farm_jobs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND requested_by = current_app_user_id());
CREATE POLICY print_farm_jobs_member_update ON print_farm_jobs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY print_farm_jobs_member_delete ON print_farm_jobs FOR DELETE TO vantage_app
  USING (requested_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON print_farm_jobs TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------- filament usage ledger
-- APPEND-ONLY. grams is a signed delta on grams_remaining (negative = consumed, positive = added).
-- Corrections are new 'audit' rows — deliberately no UPDATE/DELETE policy and no such grant.

CREATE TABLE print_farm_filament_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  filament_id uuid NOT NULL REFERENCES print_farm_filaments(id) ON DELETE CASCADE,
  job_id uuid REFERENCES print_farm_jobs(id) ON DELETE SET NULL,
  grams numeric(8, 1) NOT NULL CHECK (grams <> 0),
  reason text NOT NULL DEFAULT 'print'
    CHECK (reason IN ('print','purge','waste','restock','audit')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX print_farm_filament_usage_org_idx
  ON print_farm_filament_usage(org_id, filament_id, created_at DESC);

ALTER TABLE print_farm_filament_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY print_farm_filament_usage_member_read ON print_farm_filament_usage FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY print_farm_filament_usage_member_insert ON print_farm_filament_usage FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
-- NO update/delete policy: the ledger is append-only.

GRANT SELECT, INSERT ON print_farm_filament_usage TO vantage_app;
