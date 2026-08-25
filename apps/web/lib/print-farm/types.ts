// Shared types for the 3D Print Farm — printers, queue, filament, usage ledger.
// Every derived metric can be null; when it is, a named `reason` says why (sample too small),
// so the UI never shows a fabricated number.

export type FilamentMaterial =
  | "pla"
  | "petg"
  | "abs"
  | "asa"
  | "tpu"
  | "nylon"
  | "pc"
  | "pa_cf"
  | "resin"
  | "other";

export type PrinterStatus = "idle" | "printing" | "paused" | "maintenance" | "offline" | "retired";

export type JobStatus = "queued" | "printing" | "paused" | "done" | "failed" | "cancelled";

export type JobPriority = "low" | "normal" | "high" | "critical";

export type JobPurpose =
  | "competition_robot"
  | "practice_robot"
  | "prototype"
  | "spare"
  | "tool"
  | "fixture"
  | "outreach"
  | "other";

export type FailureReason =
  | "warp"
  | "adhesion"
  | "clog"
  | "filament_out"
  | "power"
  | "layer_shift"
  | "support"
  | "other";

export type UsageReason = "print" | "purge" | "waste" | "restock" | "audit";

export type Filament = {
  id: string;
  material: FilamentMaterial;
  brand: string | null;
  color: string | null;
  diameterMm: number | null;
  spoolGramsTotal: number | null;
  gramsRemaining: number;
  unitCostUsd: number | null;
  vendor: string | null;
  inventoryItemId: string | null;
  locationId: string | null;
  openedOn: string | null;
  archived: boolean;
};

export type Printer = {
  id: string;
  name: string;
  model: string | null;
  nozzleMm: number | null;
  buildXMm: number | null;
  buildYMm: number | null;
  buildZMm: number | null;
  /** HUMAN-REPORTED — always display with statusUpdatedAt, never imply telemetry. */
  status: PrinterStatus;
  statusUpdatedAt: string;
  equipmentAssetId: string | null;
  loadedFilamentId: string | null;
  active: boolean;
};

export type PrintJob = {
  id: string;
  seasonYear: number;
  partName: string;
  quantity: number;
  purpose: JobPurpose;
  status: JobStatus;
  priority: JobPriority;
  subsystemId: string | null;
  subsystemName: string | null;
  inventoryItemId: string | null;
  buildTaskId: string | null;
  printerId: string | null;
  filamentId: string | null;
  estimatedMinutes: number | null;
  estimatedGrams: number | null;
  actualMinutes: number | null;
  actualGrams: number | null;
  neededBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  failureReason: FailureReason | null;
  reprintOfJobId: string | null;
  requestedBy: string;
  assignedTo: string | null;
  createdAt: string;
};

export type FilamentUsage = {
  id: string;
  filamentId: string;
  jobId: string | null;
  /** Signed delta in grams: negative = consumed, positive = restock/audit-up. */
  grams: number;
  reason: UsageReason;
  createdAt: string;
};

/** A derived number that is null below its sample threshold, with the reason named. */
export type GatedMetric =
  | { value: number; sampleSize: number; reason: null }
  | { value: null; sampleSize: number; reason: string };

export type ScheduleEntry = {
  jobId: string;
  /** True when the job has no human estimate — it is excluded from the ETA, never defaulted. */
  needsEstimate: boolean;
  projectedStartAt: string | null;
  projectedFinishAt: string | null;
};

export type PrinterSchedule = {
  printerId: string;
  entries: ScheduleEntry[];
  /** Count of assigned queue jobs excluded from the ETA because they have no estimate. */
  excludedForNoEstimate: number;
};

export type SpoolStatus = {
  /** 0..1 fraction remaining, or null when spoolGramsTotal is unknown. */
  fractionRemaining: number | null;
  low: boolean;
};
