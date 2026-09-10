import type { BadgeTone } from "../../components/ui";
import { materialLabel, purposeLabel } from "../../lib/print-farm";
import type {
  FilamentView,
  JobView,
  PrintFarmView,
} from "../../lib/print-farm/compute-print-farm";
import type {
  FilamentMaterial,
  JobPriority,
  JobStatus,
  PrinterStatus,
} from "../../lib/print-farm/types";

export type LiveView = Extract<PrintFarmView, { status: "live" }>;
export type Mutate = (payload: Record<string, unknown>) => void;

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  printing: "Printing",
  paused: "Paused",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const JOB_STATUS_TONE: Record<JobStatus, BadgeTone> = {
  queued: "neutral",
  printing: "info",
  paused: "setup",
  done: "good",
  failed: "danger",
  cancelled: "neutral",
};

export const PRINTER_STATUS_LABEL: Record<PrinterStatus, string> = {
  idle: "Idle",
  printing: "Printing",
  paused: "Paused",
  maintenance: "Maintenance",
  offline: "Offline",
  retired: "Retired",
};

export const PRIORITY_LABEL: Record<JobPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  critical: "Critical",
};

export function jobStatusLabel(status: JobStatus): string {
  switch (status) {
    case "queued":
    case "printing":
    case "paused":
    case "done":
    case "failed":
    case "cancelled":
      return JOB_STATUS_LABEL[status];
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function printerStatusLabel(status: PrinterStatus): string {
  switch (status) {
    case "idle":
    case "printing":
    case "paused":
    case "maintenance":
    case "offline":
    case "retired":
      return PRINTER_STATUS_LABEL[status];
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function priorityLabel(priority: JobPriority): string {
  switch (priority) {
    case "low":
    case "normal":
    case "high":
    case "critical":
      return PRIORITY_LABEL[priority];
    default: {
      const _never: never = priority;
      return _never;
    }
  }
}

export function spoolLabel(
  filament: FilamentView | { material: FilamentMaterial; brand: string | null; color: string | null },
): string {
  return [materialLabel(filament.material), filament.brand ?? undefined, filament.color ?? undefined]
    .filter(Boolean)
    .join(" ");
}

export function jobSubtitle(job: JobView, view: LiveView): string {
  const printer = job.printerId ? view.printers.find((row) => row.id === job.printerId)?.name : null;
  const pieces = [
    `×${job.quantity}`,
    purposeLabel(job.purpose),
    PRIORITY_LABEL[job.priority],
    job.subsystemName ?? undefined,
    printer ? `on ${printer}` : "no printer yet",
    job.neededBy ? `needed by ${job.neededBy}` : undefined,
  ].filter(Boolean);
  return pieces.join(" · ");
}

export function printFarmOrgId(view: PrintFarmView | null): string | null {
  return view && "orgId" in view ? view.orgId : null;
}

export function printFarmHasAnything(view: LiveView): boolean {
  return (
    view.summary.printerCount > 0 ||
    view.summary.spoolCount > 0 ||
    view.queue.length > 0 ||
    view.recentFinished.length > 0
  );
}
