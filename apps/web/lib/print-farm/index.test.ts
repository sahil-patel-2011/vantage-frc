import { describe, expect, it } from "vitest";
import {
  atRiskJobs,
  estimateBias,
  filamentRunway,
  jobNeedsEstimate,
  orderQueue,
  printerFailureRate,
  projectPrinterSchedule,
  reportedAgoLabel,
  spoolStatus,
} from ".";
import type { FilamentUsage, PrintJob } from "./types";

const NOW = "2026-08-24T12:00:00.000Z";

function job(overrides: Partial<PrintJob> & { id: string }): PrintJob {
  return {
    seasonYear: 2026,
    partName: "Bracket",
    quantity: 1,
    purpose: "competition_robot",
    status: "queued",
    priority: "normal",
    subsystemId: null,
    subsystemName: null,
    inventoryItemId: null,
    buildTaskId: null,
    printerId: null,
    filamentId: null,
    estimatedMinutes: null,
    estimatedGrams: null,
    actualMinutes: null,
    actualGrams: null,
    neededBy: null,
    startedAt: null,
    finishedAt: null,
    failureReason: null,
    reprintOfJobId: null,
    requestedBy: "user-1",
    assignedTo: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function usage(overrides: Partial<FilamentUsage> & { id: string; filamentId: string; grams: number }): FilamentUsage {
  return {
    jobId: null,
    reason: "print",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("orderQueue", () => {
  it("orders by priority rank, then needed_by nulls last, then created_at", () => {
    const jobs = [
      job({ id: "low-early", priority: "low", createdAt: "2026-08-01T00:00:00.000Z" }),
      job({ id: "critical-late-need", priority: "critical", neededBy: "2026-09-10" }),
      job({ id: "critical-early-need", priority: "critical", neededBy: "2026-09-01" }),
      job({ id: "critical-no-need-a", priority: "critical", createdAt: "2026-08-02T00:00:00.000Z" }),
      job({ id: "critical-no-need-b", priority: "critical", createdAt: "2026-08-01T00:00:00.000Z" }),
      job({ id: "normal", priority: "normal", neededBy: "2026-08-25" }),
    ];
    expect(orderQueue(jobs).map((j) => j.id)).toEqual([
      "critical-early-need",
      "critical-late-need",
      "critical-no-need-b",
      "critical-no-need-a",
      "normal",
      "low-early",
    ]);
  });

  it("does not mutate its input", () => {
    const jobs = [job({ id: "b", priority: "low" }), job({ id: "a", priority: "critical" })];
    orderQueue(jobs);
    expect(jobs[0].id).toBe("b");
  });
});

describe("projectPrinterSchedule", () => {
  it("excludes jobs without an estimate from the ETA and flags them, never defaulting", () => {
    const jobs = [
      job({ id: "est", printerId: "p1", status: "queued", estimatedMinutes: 60 }),
      job({ id: "no-est", printerId: "p1", status: "queued", priority: "critical" }),
    ];
    const schedule = projectPrinterSchedule("p1", jobs, NOW);
    expect(schedule.excludedForNoEstimate).toBe(1);
    const noEst = schedule.entries.find((e) => e.jobId === "no-est");
    expect(noEst).toMatchObject({ needsEstimate: true, projectedFinishAt: null, projectedStartAt: null });
    const est = schedule.entries.find((e) => e.jobId === "est");
    // 60 minutes from NOW; the missing-estimate job contributed nothing to the cursor.
    expect(est?.projectedFinishAt).toBe("2026-08-24T13:00:00.000Z");
  });

  it("stacks queued jobs after the in-progress job, projected from its started_at", () => {
    const jobs = [
      job({
        id: "printing",
        printerId: "p1",
        status: "printing",
        startedAt: "2026-08-24T11:30:00.000Z",
        estimatedMinutes: 60,
      }),
      job({ id: "next", printerId: "p1", status: "queued", estimatedMinutes: 30 }),
    ];
    const schedule = projectPrinterSchedule("p1", jobs, NOW);
    const printing = schedule.entries.find((e) => e.jobId === "printing");
    expect(printing?.projectedFinishAt).toBe("2026-08-24T12:30:00.000Z");
    const next = schedule.entries.find((e) => e.jobId === "next");
    expect(next?.projectedStartAt).toBe("2026-08-24T12:30:00.000Z");
    expect(next?.projectedFinishAt).toBe("2026-08-24T13:00:00.000Z");
  });

  it("never projects an overdue in-progress job to finish in the past", () => {
    const jobs = [
      job({
        id: "overdue",
        printerId: "p1",
        status: "printing",
        startedAt: "2026-08-24T09:00:00.000Z",
        estimatedMinutes: 30,
      }),
    ];
    const schedule = projectPrinterSchedule("p1", jobs, NOW);
    expect(schedule.entries[0].projectedFinishAt).toBe(NOW);
  });

  it("applies the bias multiplier when provided", () => {
    const jobs = [job({ id: "j", printerId: "p1", status: "queued", estimatedMinutes: 60 })];
    const schedule = projectPrinterSchedule("p1", jobs, NOW, 1.5);
    expect(schedule.entries[0].projectedFinishAt).toBe("2026-08-24T13:30:00.000Z");
  });

  it("ignores jobs on other printers and finished jobs", () => {
    const jobs = [
      job({ id: "other", printerId: "p2", status: "queued", estimatedMinutes: 10 }),
      job({ id: "done", printerId: "p1", status: "done", estimatedMinutes: 10 }),
    ];
    expect(projectPrinterSchedule("p1", jobs, NOW).entries).toHaveLength(0);
  });
});

describe("estimateBias", () => {
  it("is null with a named reason under 5 completed jobs", () => {
    const jobs = [1, 2, 3, 4].map((n) =>
      job({ id: `j${n}`, status: "done", estimatedMinutes: 60, actualMinutes: 90 }),
    );
    const bias = estimateBias(jobs);
    expect(bias.value).toBeNull();
    expect(bias.sampleSize).toBe(4);
    expect(bias.reason).toContain("5 completed jobs");
  });

  it("returns the median actual/estimated ratio at 5+ samples", () => {
    const ratios = [1.0, 1.2, 1.5, 2.0, 3.0];
    const jobs = ratios.map((r, i) =>
      job({ id: `j${i}`, status: "done", estimatedMinutes: 100, actualMinutes: Math.round(100 * r) }),
    );
    const bias = estimateBias(jobs);
    expect(bias.value).toBeCloseTo(1.5);
    expect(bias.reason).toBeNull();
  });

  it("ignores failed jobs and jobs missing either figure", () => {
    const jobs = [
      job({ id: "f", status: "failed", estimatedMinutes: 60, actualMinutes: 60 }),
      job({ id: "no-actual", status: "done", estimatedMinutes: 60 }),
      job({ id: "no-est", status: "done", actualMinutes: 60 }),
    ];
    expect(estimateBias(jobs).sampleSize).toBe(0);
  });
});

describe("filamentRunway", () => {
  const filament = { id: "f1", gramsRemaining: 500 };

  it("is null with a named reason under 3 consumption rows", () => {
    const rows = [
      usage({ id: "u1", filamentId: "f1", grams: -50 }),
      usage({ id: "u2", filamentId: "f1", grams: -50 }),
      usage({ id: "restock", filamentId: "f1", grams: 1000, reason: "restock" }),
    ];
    const runway = filamentRunway(filament, rows, NOW);
    expect(runway.value).toBeNull();
    expect(runway.sampleSize).toBe(2); // restock is not consumption
    expect(runway.reason).toContain("3 usage entries");
  });

  it("computes days remaining from the observed burn rate", () => {
    // 300g consumed over the 10 days ending NOW => 30 g/day; 500g left => ~16.7 days.
    const rows = [
      usage({ id: "u1", filamentId: "f1", grams: -100, createdAt: "2026-08-14T12:00:00.000Z" }),
      usage({ id: "u2", filamentId: "f1", grams: -100, createdAt: "2026-08-19T12:00:00.000Z" }),
      usage({ id: "u3", filamentId: "f1", grams: -100, createdAt: "2026-08-22T12:00:00.000Z" }),
    ];
    const runway = filamentRunway(filament, rows, NOW);
    expect(runway.value).toBeCloseTo(500 / 30, 1);
    expect(runway.reason).toBeNull();
  });

  it("only counts rows for the given spool", () => {
    const rows = [
      usage({ id: "u1", filamentId: "other", grams: -100 }),
      usage({ id: "u2", filamentId: "other", grams: -100 }),
      usage({ id: "u3", filamentId: "other", grams: -100 }),
    ];
    expect(filamentRunway(filament, rows, NOW).value).toBeNull();
  });
});

describe("spoolStatus", () => {
  it("is null when the spool's total weight is unknown", () => {
    expect(spoolStatus({ spoolGramsTotal: null, gramsRemaining: 400 })).toEqual({
      fractionRemaining: null,
      low: false,
    });
  });

  it("flags a spool under 20% as low", () => {
    expect(spoolStatus({ spoolGramsTotal: 1000, gramsRemaining: 150 })).toEqual({
      fractionRemaining: 0.15,
      low: true,
    });
    expect(spoolStatus({ spoolGramsTotal: 1000, gramsRemaining: 600 }).low).toBe(false);
  });

  it("clamps to [0, 1]", () => {
    expect(spoolStatus({ spoolGramsTotal: 1000, gramsRemaining: 1200 }).fractionRemaining).toBe(1);
  });
});

describe("atRiskJobs", () => {
  it("flags jobs whose projected finish lands after needed_by", () => {
    const jobs = [
      job({ id: "late", printerId: "p1", status: "queued", estimatedMinutes: 3 * 24 * 60, neededBy: "2026-08-25" }),
      job({ id: "fine", printerId: "p1", status: "queued", estimatedMinutes: 30, neededBy: "2026-08-30" }),
      job({ id: "no-deadline", printerId: "p1", status: "queued", estimatedMinutes: 30 }),
      job({ id: "no-estimate", printerId: "p1", status: "queued", neededBy: "2026-08-25" }),
    ];
    const schedule = projectPrinterSchedule("p1", jobs, NOW);
    expect(atRiskJobs([schedule], jobs)).toEqual(["late"]);
  });
});

describe("printerFailureRate", () => {
  it("is null with a named reason under 5 finished jobs", () => {
    const jobs = [
      job({ id: "d1", printerId: "p1", status: "done" }),
      job({ id: "f1", printerId: "p1", status: "failed" }),
      job({ id: "queued", printerId: "p1", status: "queued" }),
    ];
    const rate = printerFailureRate("p1", jobs);
    expect(rate.value).toBeNull();
    expect(rate.sampleSize).toBe(2);
    expect(rate.reason).toContain("5 finished jobs");
  });

  it("computes failed / finished at 5+ finished jobs on that printer", () => {
    const jobs = [
      job({ id: "d1", printerId: "p1", status: "done" }),
      job({ id: "d2", printerId: "p1", status: "done" }),
      job({ id: "d3", printerId: "p1", status: "done" }),
      job({ id: "f1", printerId: "p1", status: "failed" }),
      job({ id: "f2", printerId: "p1", status: "failed" }),
      job({ id: "elsewhere", printerId: "p2", status: "failed" }),
    ];
    const rate = printerFailureRate("p1", jobs);
    expect(rate.value).toBeCloseTo(0.4);
    expect(rate.sampleSize).toBe(5);
  });
});

describe("jobNeedsEstimate", () => {
  it("is true for null or non-positive estimates", () => {
    expect(jobNeedsEstimate({ estimatedMinutes: null })).toBe(true);
    expect(jobNeedsEstimate({ estimatedMinutes: 0 })).toBe(true);
    expect(jobNeedsEstimate({ estimatedMinutes: 45 })).toBe(false);
  });
});

describe("reportedAgoLabel", () => {
  it("renders minutes, hours, and days honestly", () => {
    expect(reportedAgoLabel("2026-08-24T11:59:40.000Z", NOW)).toBe("reported just now");
    expect(reportedAgoLabel("2026-08-24T11:15:00.000Z", NOW)).toBe("reported 45m ago");
    expect(reportedAgoLabel("2026-08-24T09:00:00.000Z", NOW)).toBe("reported 3h ago");
    expect(reportedAgoLabel("2026-08-20T12:00:00.000Z", NOW)).toBe("reported 4d ago");
  });
});
