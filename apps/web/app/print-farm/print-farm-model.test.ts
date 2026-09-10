import { describe, expect, it } from "vitest";
import {
  jobStatusLabel,
  printerStatusLabel,
  priorityLabel,
  printFarmHasAnything,
  spoolLabel,
  type LiveView,
} from "./print-farm-model";
import type { JobStatus, JobPriority, PrinterStatus } from "../../lib/print-farm/types";

describe("print-farm-model", () => {
  it("labels job, printer, and priority exhaustively without inventing telemetry", () => {
    const jobs: JobStatus[] = ["queued", "printing", "paused", "done", "failed", "cancelled"];
    expect(jobs.map(jobStatusLabel)).toEqual([
      "Queued",
      "Printing",
      "Paused",
      "Done",
      "Failed",
      "Cancelled",
    ]);
    const printers: PrinterStatus[] = ["idle", "printing", "paused", "maintenance", "offline", "retired"];
    expect(printers.map(printerStatusLabel)).toEqual([
      "Idle",
      "Printing",
      "Paused",
      "Maintenance",
      "Offline",
      "Retired",
    ]);
    const priorities: JobPriority[] = ["low", "normal", "high", "critical"];
    expect(priorities.map(priorityLabel)).toEqual(["Low", "Normal", "High", "Critical"]);
  });

  it("names a spool from real material/brand/color fields", () => {
    expect(spoolLabel({ material: "pla", brand: "Polymaker", color: "Black" })).toBe("PLA Polymaker Black");
    expect(spoolLabel({ material: "petg", brand: null, color: null })).toBe("PETG");
  });

  it("does not invent farm activity from empty live counts", () => {
    const view = {
      status: "live",
      summary: { printerCount: 0, spoolCount: 0, queuedCount: 0, printingCount: 0, atRiskCount: 0, needsEstimateCount: 0, activePrinterCount: 0, gramsRemainingTotal: 0 },
      queue: [],
      recentFinished: [],
    } as unknown as LiveView;
    expect(printFarmHasAnything(view)).toBe(false);
  });
});
