// Pure helper functions for the 3D Print Farm — no I/O, unit-testable in isolation.
//
// Honesty rules encoded here:
//   * Jobs with no human estimate are EXCLUDED from every ETA and flagged needsEstimate —
//     never defaulted to a made-up duration.
//   * Every derived number (estimate bias, filament runway, failure rate) returns null with a
//     named reason below its sample threshold. The UI shows the reason, not a fake figure.

import type {
  FailureReason,
  Filament,
  FilamentMaterial,
  FilamentUsage,
  GatedMetric,
  JobPriority,
  JobPurpose,
  JobStatus,
  PrintJob,
  PrinterSchedule,
  PrinterStatus,
  ScheduleEntry,
  SpoolStatus,
  UsageReason,
} from "./types";

export const FILAMENT_MATERIALS: FilamentMaterial[] = [
  "pla",
  "petg",
  "abs",
  "asa",
  "tpu",
  "nylon",
  "pc",
  "pa_cf",
  "resin",
  "other",
];

export const PRINTER_STATUSES: PrinterStatus[] = [
  "idle",
  "printing",
  "paused",
  "maintenance",
  "offline",
  "retired",
];

export const JOB_STATUSES: JobStatus[] = ["queued", "printing", "paused", "done", "failed", "cancelled"];

export const JOB_PRIORITIES: JobPriority[] = ["low", "normal", "high", "critical"];

export const JOB_PURPOSES: JobPurpose[] = [
  "competition_robot",
  "practice_robot",
  "prototype",
  "spare",
  "tool",
  "fixture",
  "outreach",
  "other",
];

export const FAILURE_REASONS: FailureReason[] = [
  "warp",
  "adhesion",
  "clog",
  "filament_out",
  "power",
  "layer_shift",
  "support",
  "other",
];

export const USAGE_REASONS: UsageReason[] = ["print", "purge", "waste", "restock", "audit"];

export const ESTIMATE_BIAS_MIN_SAMPLE = 5;
export const RUNWAY_MIN_USAGE_ROWS = 3;
export const FAILURE_RATE_MIN_FINISHED = 5;
export const LOW_SPOOL_FRACTION = 0.2;

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

const PRIORITY_RANK: Record<JobPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

export function materialLabel(material: FilamentMaterial): string {
  switch (material) {
    case "pla":
      return "PLA";
    case "petg":
      return "PETG";
    case "abs":
      return "ABS";
    case "asa":
      return "ASA";
    case "tpu":
      return "TPU";
    case "nylon":
      return "Nylon";
    case "pc":
      return "Polycarbonate";
    case "pa_cf":
      return "PA-CF";
    case "resin":
      return "Resin";
    default:
      return "Other";
  }
}

export function purposeLabel(purpose: JobPurpose): string {
  switch (purpose) {
    case "competition_robot":
      return "Competition robot";
    case "practice_robot":
      return "Practice robot";
    case "prototype":
      return "Prototype";
    case "spare":
      return "Spare";
    case "tool":
      return "Tool";
    case "fixture":
      return "Fixture";
    case "outreach":
      return "Outreach";
    default:
      return "Other";
  }
}

export function failureReasonLabel(reason: FailureReason): string {
  switch (reason) {
    case "warp":
      return "Warping";
    case "adhesion":
      return "Bed adhesion";
    case "clog":
      return "Clogged nozzle";
    case "filament_out":
      return "Ran out of filament";
    case "power":
      return "Power loss";
    case "layer_shift":
      return "Layer shift";
    case "support":
      return "Support failure";
    default:
      return "Other";
  }
}

/** True when the job carries no human time estimate — it must never enter an ETA. */
export function jobNeedsEstimate(job: Pick<PrintJob, "estimatedMinutes">): boolean {
  return job.estimatedMinutes == null || job.estimatedMinutes <= 0;
}

/**
 * Queue ordering: priority rank first, then needed_by (nulls last), then created_at.
 * Does not filter — pass it the jobs you want ordered.
 */
export function orderQueue<T extends Pick<PrintJob, "priority" | "neededBy" | "createdAt">>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => {
    const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (rank !== 0) return rank;
    if (a.neededBy !== b.neededBy) {
      if (a.neededBy == null) return 1;
      if (b.neededBy == null) return -1;
      return a.neededBy < b.neededBy ? -1 : 1;
    }
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

/**
 * Cumulative projected schedule for one printer from its assigned queue/printing jobs.
 * A currently-printing job projects from its started_at; queued jobs stack after it.
 * Jobs without an estimate contribute nothing to the cursor and are flagged needsEstimate.
 * `biasMultiplier` (from estimateBias) scales estimates when known; pass null to use raw estimates.
 */
export function projectPrinterSchedule(
  printerId: string,
  jobs: PrintJob[],
  nowIso: string,
  biasMultiplier: number | null = null,
): PrinterSchedule {
  const nowMs = Date.parse(nowIso);
  const assigned = jobs.filter(
    (job) => job.printerId === printerId && (job.status === "printing" || job.status === "queued" || job.status === "paused"),
  );
  const printing = assigned.filter((job) => job.status === "printing" || job.status === "paused");
  const queued = orderQueue(assigned.filter((job) => job.status === "queued"));
  const ordered = [...printing, ...queued];

  const bias = biasMultiplier != null && biasMultiplier > 0 ? biasMultiplier : 1;
  let cursorMs = nowMs;
  let excluded = 0;
  const entries: ScheduleEntry[] = [];

  for (const job of ordered) {
    if (jobNeedsEstimate(job)) {
      excluded += 1;
      entries.push({ jobId: job.id, needsEstimate: true, projectedStartAt: null, projectedFinishAt: null });
      continue;
    }
    const durationMs = (job.estimatedMinutes as number) * bias * MS_PER_MINUTE;
    const startMs =
      (job.status === "printing" || job.status === "paused") && job.startedAt != null
        ? Date.parse(job.startedAt)
        : cursorMs;
    const finishMs = Math.max(startMs + durationMs, nowMs);
    cursorMs = Math.max(cursorMs, finishMs);
    entries.push({
      jobId: job.id,
      needsEstimate: false,
      projectedStartAt: new Date(startMs).toISOString(),
      projectedFinishAt: new Date(finishMs).toISOString(),
    });
  }

  return { printerId, entries, excludedForNoEstimate: excluded };
}

/**
 * Median actual/estimated minutes multiplier across completed jobs.
 * Null (with reason) under ESTIMATE_BIAS_MIN_SAMPLE completed jobs that carry both figures.
 */
export function estimateBias(jobs: PrintJob[]): GatedMetric {
  const ratios = jobs
    .filter(
      (job) =>
        job.status === "done" &&
        job.actualMinutes != null &&
        job.actualMinutes > 0 &&
        job.estimatedMinutes != null &&
        job.estimatedMinutes > 0,
    )
    .map((job) => (job.actualMinutes as number) / (job.estimatedMinutes as number));

  if (ratios.length < ESTIMATE_BIAS_MIN_SAMPLE) {
    return {
      value: null,
      sampleSize: ratios.length,
      reason: `needs ${ESTIMATE_BIAS_MIN_SAMPLE} completed jobs with estimate and actual (have ${ratios.length})`,
    };
  }
  const sorted = [...ratios].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return { value: median, sampleSize: ratios.length, reason: null };
}

/**
 * Days of filament left at the observed consumption rate for one spool.
 * Uses only consumption rows (grams < 0). Null (with reason) under RUNWAY_MIN_USAGE_ROWS rows.
 */
export function filamentRunway(
  filament: Pick<Filament, "id" | "gramsRemaining">,
  usage: FilamentUsage[],
  nowIso: string,
): GatedMetric {
  const consumption = usage
    .filter((row) => row.filamentId === filament.id && row.grams < 0)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  if (consumption.length < RUNWAY_MIN_USAGE_ROWS) {
    return {
      value: null,
      sampleSize: consumption.length,
      reason: `needs ${RUNWAY_MIN_USAGE_ROWS} usage entries (have ${consumption.length})`,
    };
  }

  const totalConsumed = consumption.reduce((sum, row) => sum + Math.abs(row.grams), 0);
  const firstMs = Date.parse(consumption[0]?.createdAt ?? nowIso);
  const nowMs = Date.parse(nowIso);
  const spanDays = Math.max((nowMs - firstMs) / MS_PER_DAY, 1);
  const gramsPerDay = totalConsumed / spanDays;
  if (gramsPerDay <= 0) {
    return { value: null, sampleSize: consumption.length, reason: "no measurable consumption rate" };
  }
  return { value: filament.gramsRemaining / gramsPerDay, sampleSize: consumption.length, reason: null };
}

/** Fraction of the spool remaining (null when the spool's total weight is unknown). */
export function spoolStatus(filament: Pick<Filament, "spoolGramsTotal" | "gramsRemaining">): SpoolStatus {
  if (filament.spoolGramsTotal == null || filament.spoolGramsTotal <= 0) {
    return { fractionRemaining: null, low: false };
  }
  const fraction = Math.min(Math.max(filament.gramsRemaining / filament.spoolGramsTotal, 0), 1);
  return { fractionRemaining: fraction, low: fraction < LOW_SPOOL_FRACTION };
}

/**
 * Jobs whose projected finish lands after their needed_by date (end of that day, UTC).
 * Only jobs that HAVE a projection can be at risk; needsEstimate jobs are reported separately.
 */
export function atRiskJobs(schedules: PrinterSchedule[], jobs: PrintJob[]): string[] {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const atRisk: string[] = [];
  for (const schedule of schedules) {
    for (const entry of schedule.entries) {
      if (entry.needsEstimate || entry.projectedFinishAt == null) continue;
      const job = byId.get(entry.jobId);
      if (!job || job.neededBy == null) continue;
      const deadlineMs = Date.parse(`${job.neededBy}T23:59:59Z`);
      if (Date.parse(entry.projectedFinishAt) > deadlineMs) atRisk.push(entry.jobId);
    }
  }
  return atRisk;
}

/**
 * Fraction of finished (done|failed) jobs on this printer that failed.
 * Null (with reason) under FAILURE_RATE_MIN_FINISHED finished jobs.
 */
export function printerFailureRate(printerId: string, jobs: PrintJob[]): GatedMetric {
  const finished = jobs.filter(
    (job) => job.printerId === printerId && (job.status === "done" || job.status === "failed"),
  );
  if (finished.length < FAILURE_RATE_MIN_FINISHED) {
    return {
      value: null,
      sampleSize: finished.length,
      reason: `needs ${FAILURE_RATE_MIN_FINISHED} finished jobs (have ${finished.length})`,
    };
  }
  const failed = finished.filter((job) => job.status === "failed").length;
  return { value: failed / finished.length, sampleSize: finished.length, reason: null };
}

/** "reported 3h ago" label for a human-reported printer status. */
export function reportedAgoLabel(statusUpdatedAtIso: string, nowIso: string): string {
  const deltaMs = Date.parse(nowIso) - Date.parse(statusUpdatedAtIso);
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return "reported just now";
  const minutes = Math.floor(deltaMs / MS_PER_MINUTE);
  if (minutes < 1) return "reported just now";
  if (minutes < 60) return `reported ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `reported ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `reported ${days}d ago`;
}
