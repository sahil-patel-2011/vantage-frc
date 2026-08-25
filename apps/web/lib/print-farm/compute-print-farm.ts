// 3D Print Farm view computation + write helpers. All queries run through the caller's
// withRls PoolClient (single transaction), raw parameterized SQL only.
//
// Honesty: printer status is HUMAN-REPORTED (surfaced with statusUpdatedAt); every derived
// number is null with a named reason below its sample threshold; jobs without an estimate
// are excluded from ETAs and flagged needsEstimate.

import type { PoolClient } from "@neondatabase/serverless";
import {
  atRiskJobs,
  estimateBias,
  filamentRunway,
  jobNeedsEstimate,
  orderQueue,
  printerFailureRate,
  projectPrinterSchedule,
  spoolStatus,
} from ".";
import type {
  FailureReason,
  Filament,
  FilamentMaterial,
  FilamentUsage,
  GatedMetric,
  JobPriority,
  JobPurpose,
  PrintJob,
  Printer,
  PrinterSchedule,
  PrinterStatus,
  SpoolStatus,
  UsageReason,
} from "./types";

export type PrintFarmSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type PrinterView = Printer & {
  failureRate: GatedMetric;
  schedule: PrinterSchedule;
};

export type FilamentView = Filament & {
  spool: SpoolStatus;
  runwayDays: GatedMetric;
};

export type JobView = PrintJob & {
  needsEstimate: boolean;
  projectedFinishAt: string | null;
  atRisk: boolean;
};

export type PrintFarmSummary = {
  queuedCount: number;
  printingCount: number;
  doneCount: number;
  failedCount: number;
  printerCount: number;
  activePrinterCount: number;
  spoolCount: number;
  gramsRemainingTotal: number;
  atRiskCount: number;
  needsEstimateCount: number;
};

export type PrintFarmView =
  | {
      status: "setup_required";
      message: string;
      steps: PrintFarmSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      printers: PrinterView[];
      filaments: FilamentView[];
      queue: JobView[];
      recentFinished: JobView[];
      estimateBias: GatedMetric;
      summary: PrintFarmSummary;
      computedAt: string;
    };

type FilamentRow = {
  id: string;
  material: FilamentMaterial;
  brand: string | null;
  color: string | null;
  diameterMm: string | null;
  spoolGramsTotal: string | null;
  gramsRemaining: string;
  unitCostUsd: string | null;
  vendor: string | null;
  inventoryItemId: string | null;
  locationId: string | null;
  openedOn: string | null;
  archived: boolean;
};

type PrinterRow = {
  id: string;
  name: string;
  model: string | null;
  nozzleMm: string | null;
  buildXMm: number | null;
  buildYMm: number | null;
  buildZMm: number | null;
  status: PrinterStatus;
  statusUpdatedAt: string;
  equipmentAssetId: string | null;
  loadedFilamentId: string | null;
  active: boolean;
};

type JobRow = {
  id: string;
  seasonYear: number;
  partName: string;
  quantity: number;
  purpose: JobPurpose;
  status: PrintJob["status"];
  priority: JobPriority;
  subsystemId: string | null;
  subsystemName: string | null;
  inventoryItemId: string | null;
  buildTaskId: string | null;
  printerId: string | null;
  filamentId: string | null;
  estimatedMinutes: number | null;
  estimatedGrams: string | null;
  actualMinutes: number | null;
  actualGrams: string | null;
  neededBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  failureReason: FailureReason | null;
  reprintOfJobId: string | null;
  requestedBy: string;
  assignedTo: string | null;
  createdAt: string;
};

type UsageRow = {
  id: string;
  filamentId: string;
  jobId: string | null;
  grams: string;
  reason: UsageReason;
  createdAt: string;
};

function num(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapFilament(row: FilamentRow): Filament {
  return {
    id: row.id,
    material: row.material,
    brand: row.brand,
    color: row.color,
    diameterMm: num(row.diameterMm),
    spoolGramsTotal: num(row.spoolGramsTotal),
    gramsRemaining: num(row.gramsRemaining) ?? 0,
    unitCostUsd: num(row.unitCostUsd),
    vendor: row.vendor,
    inventoryItemId: row.inventoryItemId,
    locationId: row.locationId,
    openedOn: row.openedOn,
    archived: row.archived,
  };
}

function mapPrinter(row: PrinterRow): Printer {
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    nozzleMm: num(row.nozzleMm),
    buildXMm: row.buildXMm,
    buildYMm: row.buildYMm,
    buildZMm: row.buildZMm,
    status: row.status,
    statusUpdatedAt: row.statusUpdatedAt,
    equipmentAssetId: row.equipmentAssetId,
    loadedFilamentId: row.loadedFilamentId,
    active: row.active,
  };
}

function mapJob(row: JobRow): PrintJob {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    partName: row.partName,
    quantity: row.quantity,
    purpose: row.purpose,
    status: row.status,
    priority: row.priority,
    subsystemId: row.subsystemId,
    subsystemName: row.subsystemName,
    inventoryItemId: row.inventoryItemId,
    buildTaskId: row.buildTaskId,
    printerId: row.printerId,
    filamentId: row.filamentId,
    estimatedMinutes: row.estimatedMinutes,
    estimatedGrams: num(row.estimatedGrams),
    actualMinutes: row.actualMinutes,
    actualGrams: num(row.actualGrams),
    neededBy: row.neededBy,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    failureReason: row.failureReason,
    reprintOfJobId: row.reprintOfJobId,
    requestedBy: row.requestedBy,
    assignedTo: row.assignedTo,
    createdAt: row.createdAt,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

export async function computePrintFarmView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; now?: Date },
): Promise<PrintFarmView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to run the print farm.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [filamentResult, printerResult, jobResult, usageResult] = await Promise.all([
    client.query<FilamentRow>(
      `SELECT id, material, brand, color,
              diameter_mm::text AS "diameterMm", spool_grams_total::text AS "spoolGramsTotal",
              grams_remaining::text AS "gramsRemaining", unit_cost_usd::text AS "unitCostUsd",
              vendor, inventory_item_id AS "inventoryItemId", location_id AS "locationId",
              opened_on::text AS "openedOn", archived
       FROM print_farm_filaments
       WHERE org_id = $1::uuid AND archived = false
       ORDER BY material, brand NULLS LAST, color NULLS LAST, created_at`,
      [org.orgId],
    ),
    client.query<PrinterRow>(
      `SELECT id, name, model, nozzle_mm::text AS "nozzleMm",
              build_x_mm AS "buildXMm", build_y_mm AS "buildYMm", build_z_mm AS "buildZMm",
              status, status_updated_at::text AS "statusUpdatedAt",
              equipment_asset_id AS "equipmentAssetId", loaded_filament_id AS "loadedFilamentId", active
       FROM print_farm_printers
       WHERE org_id = $1::uuid
       ORDER BY active DESC, name ASC`,
      [org.orgId],
    ),
    client.query<JobRow>(
      `SELECT id, season_year AS "seasonYear", part_name AS "partName", quantity, purpose, status, priority,
              subsystem_id AS "subsystemId", subsystem_name AS "subsystemName",
              inventory_item_id AS "inventoryItemId", build_task_id AS "buildTaskId",
              printer_id AS "printerId", filament_id AS "filamentId",
              estimated_minutes AS "estimatedMinutes", estimated_grams::text AS "estimatedGrams",
              actual_minutes AS "actualMinutes", actual_grams::text AS "actualGrams",
              needed_by::text AS "neededBy", started_at::text AS "startedAt", finished_at::text AS "finishedAt",
              failure_reason AS "failureReason", reprint_of_job_id AS "reprintOfJobId",
              requested_by AS "requestedBy", assigned_to AS "assignedTo", created_at::text AS "createdAt"
       FROM print_farm_jobs
       WHERE org_id = $1::uuid
       ORDER BY created_at DESC
       LIMIT 500`,
      [org.orgId],
    ),
    client.query<UsageRow>(
      `SELECT id, filament_id AS "filamentId", job_id AS "jobId", grams::text AS "grams", reason,
              created_at::text AS "createdAt"
       FROM print_farm_filament_usage
       WHERE org_id = $1::uuid
       ORDER BY created_at DESC
       LIMIT 1000`,
      [org.orgId],
    ),
  ]);

  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  const filaments = filamentResult.rows.map(mapFilament);
  const printers = printerResult.rows.map(mapPrinter);
  const jobs = jobResult.rows.map(mapJob);
  const usage: FilamentUsage[] = usageResult.rows.map((row) => ({
    id: row.id,
    filamentId: row.filamentId,
    jobId: row.jobId,
    grams: num(row.grams) ?? 0,
    reason: row.reason,
    createdAt: row.createdAt,
  }));

  const bias = estimateBias(jobs);
  const schedules = printers.map((printer) => projectPrinterSchedule(printer.id, jobs, nowIso, bias.value));
  const finishById = new Map<string, string | null>();
  for (const schedule of schedules) {
    for (const entry of schedule.entries) finishById.set(entry.jobId, entry.projectedFinishAt);
  }
  const atRiskIds = new Set(atRiskJobs(schedules, jobs));

  const toJobView = (job: PrintJob): JobView => ({
    ...job,
    needsEstimate: jobNeedsEstimate(job),
    projectedFinishAt: finishById.get(job.id) ?? null,
    atRisk: atRiskIds.has(job.id),
  });

  const active = jobs.filter((job) => job.status === "queued" || job.status === "printing" || job.status === "paused");
  const printing = active.filter((job) => job.status !== "queued");
  const queue = [...printing, ...orderQueue(active.filter((job) => job.status === "queued"))].map(toJobView);
  const recentFinished = jobs
    .filter((job) => job.status === "done" || job.status === "failed" || job.status === "cancelled")
    .sort((a, b) => ((a.finishedAt ?? a.createdAt) < (b.finishedAt ?? b.createdAt) ? 1 : -1))
    .slice(0, 20)
    .map(toJobView);

  const scheduleByPrinter = new Map(schedules.map((schedule) => [schedule.printerId, schedule]));
  const printerViews: PrinterView[] = printers.map((printer) => ({
    ...printer,
    failureRate: printerFailureRate(printer.id, jobs),
    schedule:
      scheduleByPrinter.get(printer.id) ?? { printerId: printer.id, entries: [], excludedForNoEstimate: 0 },
  }));

  const filamentViews: FilamentView[] = filaments.map((filament) => ({
    ...filament,
    spool: spoolStatus(filament),
    runwayDays: filamentRunway(filament, usage, nowIso),
  }));

  const summary: PrintFarmSummary = {
    queuedCount: jobs.filter((job) => job.status === "queued").length,
    printingCount: jobs.filter((job) => job.status === "printing" || job.status === "paused").length,
    doneCount: jobs.filter((job) => job.status === "done").length,
    failedCount: jobs.filter((job) => job.status === "failed").length,
    printerCount: printers.length,
    activePrinterCount: printers.filter((printer) => printer.active).length,
    spoolCount: filaments.length,
    gramsRemainingTotal: filaments.reduce((sum, filament) => sum + filament.gramsRemaining, 0),
    atRiskCount: queue.filter((job) => job.atRisk).length,
    needsEstimateCount: queue.filter((job) => job.needsEstimate).length,
  };

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    printers: printerViews,
    filaments: filamentViews,
    queue,
    recentFinished,
    estimateBias: bias,
    summary,
    computedAt: nowIso,
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addPrinter(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    model: string | null;
    nozzleMm: number | null;
    buildXMm: number | null;
    buildYMm: number | null;
    buildZMm: number | null;
    equipmentAssetId: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO print_farm_printers (
       org_id, name, model, nozzle_mm, build_x_mm, build_y_mm, build_z_mm, equipment_asset_id, created_by
     ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8::uuid,$9::uuid)`,
    [
      input.orgId,
      input.name,
      input.model,
      input.nozzleMm,
      input.buildXMm,
      input.buildYMm,
      input.buildZMm,
      input.equipmentAssetId,
      input.userId,
    ],
  );
}

export async function updatePrinter(
  client: PoolClient,
  input: { orgId: string; printerId: string; name: string | null; model: string | null; active: boolean | null },
): Promise<void> {
  await client.query(
    `UPDATE print_farm_printers
     SET name = coalesce($3, name), model = coalesce($4, model), active = coalesce($5, active)
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.printerId, input.orgId, input.name, input.model, input.active],
  );
}

/** Human status report: stamps status_updated_at so the UI can say "reported Nh ago". */
export async function setPrinterStatus(
  client: PoolClient,
  input: { orgId: string; printerId: string; status: PrinterStatus },
): Promise<void> {
  await client.query(
    `UPDATE print_farm_printers SET status = $3, status_updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.printerId, input.orgId, input.status],
  );
}

export async function loadFilament(
  client: PoolClient,
  input: { orgId: string; printerId: string; filamentId: string | null },
): Promise<void> {
  await client.query(
    `UPDATE print_farm_printers SET loaded_filament_id = $3::uuid
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.printerId, input.orgId, input.filamentId],
  );
}

export async function addSpool(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    material: FilamentMaterial;
    brand: string | null;
    color: string | null;
    diameterMm: number | null;
    spoolGramsTotal: number | null;
    gramsRemaining: number;
    unitCostUsd: number | null;
    vendor: string | null;
    openedOn: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO print_farm_filaments (
       org_id, material, brand, color, diameter_mm, spool_grams_total, grams_remaining,
       unit_cost_usd, vendor, opened_on, created_by
     ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::uuid)`,
    [
      input.orgId,
      input.material,
      input.brand,
      input.color,
      input.diameterMm,
      input.spoolGramsTotal,
      input.gramsRemaining,
      input.unitCostUsd,
      input.vendor,
      input.openedOn,
      input.userId,
    ],
  );
}

/**
 * Manual spool correction/restock: appends the signed ledger row and applies the same delta to
 * grams_remaining in the caller's transaction (clamped at zero by the app before the CHECK).
 */
export async function adjustSpool(
  client: PoolClient,
  input: { orgId: string; userId: string; filamentId: string; grams: number; reason: UsageReason },
): Promise<void> {
  await client.query(
    `INSERT INTO print_farm_filament_usage (org_id, filament_id, grams, reason, created_by)
     VALUES ($1::uuid,$2::uuid,$3,$4,$5::uuid)`,
    [input.orgId, input.filamentId, input.grams, input.reason, input.userId],
  );
  await client.query(
    `UPDATE print_farm_filaments
     SET grams_remaining = GREATEST(0, grams_remaining + $3), updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.filamentId, input.orgId, input.grams],
  );
}

export async function queueJob(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    partName: string;
    quantity: number;
    purpose: JobPurpose;
    priority: JobPriority;
    subsystemName: string | null;
    printerId: string | null;
    filamentId: string | null;
    estimatedMinutes: number | null;
    estimatedGrams: number | null;
    neededBy: string | null;
    reprintOfJobId: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO print_farm_jobs (
       org_id, season_year, part_name, quantity, purpose, priority, subsystem_name,
       printer_id, filament_id, estimated_minutes, estimated_grams, needed_by,
       reprint_of_job_id, requested_by
     ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8::uuid,$9::uuid,$10,$11,$12::date,$13::uuid,$14::uuid)`,
    [
      input.orgId,
      input.seasonYear,
      input.partName,
      input.quantity,
      input.purpose,
      input.priority,
      input.subsystemName,
      input.printerId,
      input.filamentId,
      input.estimatedMinutes,
      input.estimatedGrams,
      input.neededBy,
      input.reprintOfJobId,
      input.userId,
    ],
  );
}

export async function updateJob(
  client: PoolClient,
  input: {
    orgId: string;
    jobId: string;
    priority: JobPriority | null;
    printerId: string | null;
    filamentId: string | null;
    estimatedMinutes: number | null;
    estimatedGrams: number | null;
    neededBy: string | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE print_farm_jobs
     SET priority = coalesce($3, priority),
         printer_id = coalesce($4::uuid, printer_id),
         filament_id = coalesce($5::uuid, filament_id),
         estimated_minutes = coalesce($6, estimated_minutes),
         estimated_grams = coalesce($7, estimated_grams),
         needed_by = coalesce($8::date, needed_by),
         updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid AND status IN ('queued','printing','paused')`,
    [
      input.jobId,
      input.orgId,
      input.priority,
      input.printerId,
      input.filamentId,
      input.estimatedMinutes,
      input.estimatedGrams,
      input.neededBy,
    ],
  );
}

export async function claimJob(
  client: PoolClient,
  input: { orgId: string; userId: string; jobId: string },
): Promise<void> {
  await client.query(
    `UPDATE print_farm_jobs SET assigned_to = $3::uuid, updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid AND status = 'queued'`,
    [input.jobId, input.orgId, input.userId],
  );
}

/** Marks the job printing; also stamps the printer as human-reported 'printing' when assigned. */
export async function startJob(
  client: PoolClient,
  input: { orgId: string; jobId: string; printerId: string | null; filamentId: string | null },
): Promise<void> {
  const result = await client.query<{ printerId: string | null }>(
    `UPDATE print_farm_jobs
     SET status = 'printing', started_at = now(),
         printer_id = coalesce($3::uuid, printer_id),
         filament_id = coalesce($4::uuid, filament_id),
         updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid AND status IN ('queued','paused')
     RETURNING printer_id AS "printerId"`,
    [input.jobId, input.orgId, input.printerId, input.filamentId],
  );
  const printerId = result.rows[0]?.printerId ?? null;
  if (printerId) {
    await setPrinterStatus(client, { orgId: input.orgId, printerId, status: "printing" });
  }
}

/**
 * Completes a job. In the SAME transaction: appends the filament-usage ledger row (negative
 * grams) and decrements the spool's grams_remaining. The printer, when known, is stamped back
 * to human-reported 'idle'.
 */
export async function finishJob(
  client: PoolClient,
  input: { orgId: string; userId: string; jobId: string; actualMinutes: number | null; actualGrams: number | null },
): Promise<void> {
  const result = await client.query<{ printerId: string | null; filamentId: string | null }>(
    `UPDATE print_farm_jobs
     SET status = 'done', finished_at = now(), actual_minutes = $3, actual_grams = $4, updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid AND status IN ('printing','paused','queued')
     RETURNING printer_id AS "printerId", filament_id AS "filamentId"`,
    [input.jobId, input.orgId, input.actualMinutes, input.actualGrams],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Job is not open");

  if (row.filamentId && input.actualGrams != null && input.actualGrams > 0) {
    await client.query(
      `INSERT INTO print_farm_filament_usage (org_id, filament_id, job_id, grams, reason, created_by)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'print',$5::uuid)`,
      [input.orgId, row.filamentId, input.jobId, -input.actualGrams, input.userId],
    );
    await client.query(
      `UPDATE print_farm_filaments
       SET grams_remaining = GREATEST(0, grams_remaining - $3), updated_at = now()
       WHERE id = $1::uuid AND org_id = $2::uuid`,
      [row.filamentId, input.orgId, input.actualGrams],
    );
  }
  if (row.printerId) {
    await setPrinterStatus(client, { orgId: input.orgId, printerId: row.printerId, status: "idle" });
  }
}

/**
 * Fails a job. In the SAME transaction: any filament already burned is appended to the ledger
 * as 'waste' (negative grams) and the spool decremented. Printer stamped back to 'idle'.
 */
export async function failJob(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    jobId: string;
    failureReason: FailureReason;
    actualMinutes: number | null;
    wastedGrams: number | null;
  },
): Promise<void> {
  const result = await client.query<{ printerId: string | null; filamentId: string | null }>(
    `UPDATE print_farm_jobs
     SET status = 'failed', finished_at = now(), failure_reason = $3,
         actual_minutes = $4, actual_grams = $5, updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid AND status IN ('printing','paused','queued')
     RETURNING printer_id AS "printerId", filament_id AS "filamentId"`,
    [input.jobId, input.orgId, input.failureReason, input.actualMinutes, input.wastedGrams],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Job is not open");

  if (row.filamentId && input.wastedGrams != null && input.wastedGrams > 0) {
    await client.query(
      `INSERT INTO print_farm_filament_usage (org_id, filament_id, job_id, grams, reason, created_by)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'waste',$5::uuid)`,
      [input.orgId, row.filamentId, input.jobId, -input.wastedGrams, input.userId],
    );
    await client.query(
      `UPDATE print_farm_filaments
       SET grams_remaining = GREATEST(0, grams_remaining - $3), updated_at = now()
       WHERE id = $1::uuid AND org_id = $2::uuid`,
      [row.filamentId, input.orgId, input.wastedGrams],
    );
  }
  if (row.printerId) {
    await setPrinterStatus(client, { orgId: input.orgId, printerId: row.printerId, status: "idle" });
  }
}

export async function cancelJob(
  client: PoolClient,
  input: { orgId: string; jobId: string },
): Promise<void> {
  await client.query(
    `UPDATE print_farm_jobs SET status = 'cancelled', finished_at = now(), updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid AND status IN ('queued','printing','paused')`,
    [input.jobId, input.orgId],
  );
}
